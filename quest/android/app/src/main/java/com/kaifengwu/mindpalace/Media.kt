package com.kaifengwu.mindpalace

import android.content.res.AssetManager
import android.graphics.Bitmap
import android.graphics.ColorSpace
import android.graphics.ImageDecoder
import android.graphics.SurfaceTexture
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Surface
import java.io.File
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.roundToInt

/** Pictures, decoded by Android (JPEG, PNG and HEIC alike). Called from the native frame thread. */
object Media {
    /** A path that is a file inside the APK, as platform_android.cpp gives the judging build's media: "apk:media/…". */
    const val IN_APK = "apk:"
    lateinit var assets: AssetManager

    /**
     * A picture file as an ARGB_8888 bitmap in sRGB, no larger than
     * `maxPixel` on its longer side when that is above zero. Null if it
     * can't be read.
     */
    @JvmStatic
    fun decodeImage(path: String, maxPixel: Int): Bitmap? {
        return try {
            val source = if (path.startsWith(IN_APK)) ImageDecoder.createSource(assets, path.substring(IN_APK.length)) else ImageDecoder.createSource(File(path))
            val bitmap = ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                decoder.setTargetColorSpace(ColorSpace.get(ColorSpace.Named.SRGB))
                val longer = max(info.size.width, info.size.height)
                if (maxPixel in 1 until longer) {
                    val k = maxPixel.toFloat() / longer
                    decoder.setTargetSize(max(1, (info.size.width * k).roundToInt()), max(1, (info.size.height * k).roundToInt()))
                }
            }
            if (bitmap.config == Bitmap.Config.ARGB_8888) bitmap else bitmap.copy(Bitmap.Config.ARGB_8888, false)
        } catch (e: Exception) {
            Log.w("ocean", "[media] could not decode $path: $e")
            null
        }
    }
}

/**
 * One video, playing into an OpenGL external texture: what AVPlayer with a
 * VideoMaterial is on visionOS. Made on the native frame thread, which owns
 * the texture; `update` must be called there too.
 *
 * Everything that touches the MediaPlayer runs on this object's own thread,
 * in the order it was asked for: making a player, opening a file and letting
 * one go each take tens of milliseconds, which the frame thread cannot spare.
 */
class VideoSurface(textureName: Int) {
    private val surfaceTexture = SurfaceTexture(textureName)
    private val surface = Surface(surfaceTexture)
    private val worker = Executors.newSingleThreadExecutor()
    @Volatile private var player: MediaPlayer? = null
    @Volatile private var frameAvailable = false
    @Volatile private var prepared = false
    @Volatile private var ended = false
    @Volatile private var hasFrame = false
    @Volatile private var released = false
    @Volatile private var wantPlaying = false
    @Volatile private var pendingSeekMs = -1
    @Volatile private var volume = 1f
    @Volatile private var muted = false
    @Volatile private var asked = 0          // counts loads, so a film asked for and then replaced is never opened

    init {
        surfaceTexture.setOnFrameAvailableListener({ frameAvailable = true }, Handler(Looper.getMainLooper()))
    }

    /** Opens a film; an empty path lets the current one go. */
    fun load(path: String) {
        prepared = false
        ended = false
        hasFrame = false
        pendingSeekMs = -1
        val mine = ++asked
        worker.execute {
            try {
                player?.release()
            } catch (e: Exception) {
            }
            player = null
            if (path.isEmpty() || mine != asked || released) return@execute
            // What the log may say of it: never what follows its "?", where the service's address carries the headset's token.
            val shown = path.substringBefore('?')
            val p = MediaPlayer()
            try {
                p.setSurface(surface)
                // Inside the APK a film is stored uncompressed (app/build.gradle.kts), so it can be played from where it lies.
                if (path.startsWith(Media.IN_APK)) Media.assets.openFd(path.substring(Media.IN_APK.length)).use { p.setDataSource(it) }
                else p.setDataSource(path)
                p.setOnPreparedListener { mp ->
                    worker.execute {
                        if (player !== mp) return@execute
                        try {
                            prepared = true
                            applyVolume()
                            if (pendingSeekMs >= 0) {
                                mp.seekTo(pendingSeekMs.toLong(), MediaPlayer.SEEK_CLOSEST)
                                pendingSeekMs = -1
                            }
                            if (wantPlaying) mp.start()
                        } catch (e: Exception) {
                            Log.w("ocean", "[media] could not start $shown: $e")
                        }
                    }
                }
                p.setOnCompletionListener { ended = true }
                // A film that will not open (a link gone stale, an address that refuses it) is said once; the card keeps its
                // poster and play mark, as no frame ever comes.
                p.setOnErrorListener { _, what, extra ->
                    val why = when {
                        what == MediaPlayer.MEDIA_ERROR_SERVER_DIED -> "the system's player stopped"
                        extra == MediaPlayer.MEDIA_ERROR_IO -> "it could not be read (refused, gone, or no connection)"
                        extra == MediaPlayer.MEDIA_ERROR_MALFORMED -> "it is not a video the player can read"
                        extra == MediaPlayer.MEDIA_ERROR_UNSUPPORTED -> "it is in a form the player does not play"
                        extra == MediaPlayer.MEDIA_ERROR_TIMED_OUT -> "it took too long to answer"
                        else -> "error $what/$extra"
                    }
                    Log.w("ocean", "[media] $shown does not play: $why")
                    true
                }
                player = p
                p.prepareAsync()
            } catch (e: Exception) {
                Log.w("ocean", "[media] $shown does not play: it could not be opened ($e)")
                try {
                    p.release()
                } catch (e2: Exception) {
                }
                player = null
            }
        }
    }

    private fun onPlayer(what: (MediaPlayer) -> Unit) {
        worker.execute {
            val p = player ?: return@execute
            if (!prepared) return@execute
            try {
                what(p)
            } catch (e: Exception) {
            }
        }
    }

    fun play() {
        wantPlaying = true
        ended = false
        onPlayer { it.start() }
    }

    fun pause() {
        wantPlaying = false
        onPlayer { if (it.isPlaying) it.pause() }
    }

    fun seek(seconds: Double) {
        val ms = (seconds * 1000).toInt().coerceAtLeast(0)
        ended = false
        worker.execute {
            val p = player
            try {
                if (prepared && p != null) p.seekTo(ms.toLong(), MediaPlayer.SEEK_CLOSEST) else pendingSeekMs = ms
            } catch (e: Exception) {
            }
        }
    }

    fun currentTime(): Double {
        val p = player
        if (prepared && p != null) {
            try {
                return p.currentPosition / 1000.0
            } catch (e: Exception) {
            }
        }
        return max(pendingSeekMs, 0) / 1000.0
    }

    fun duration(): Double {
        val p = player
        if (prepared && p != null) {
            try {
                return max(p.duration, 0) / 1000.0
            } catch (e: Exception) {
            }
        }
        return 0.0
    }

    fun setVolume(v: Float) {
        volume = v
        worker.execute { applyVolume() }
    }

    fun setMuted(m: Boolean) {
        muted = m
        worker.execute { applyVolume() }
    }

    private fun applyVolume() {
        if (!prepared) return
        val v = if (muted) 0f else volume.coerceIn(0f, 1f)
        try {
            player?.setVolume(v, v)
        } catch (e: Exception) {
        }
    }

    fun playing(): Boolean = wantPlaying && !ended

    fun ready(): Boolean = hasFrame

    /** True once, after the item has played to its end. */
    fun takeEnded(): Boolean {
        if (!ended) return false
        ended = false
        wantPlaying = false
        return true
    }

    /**
     * On the frame thread: latches the newest frame into the texture and
     * writes the texture-coordinate transform (4x4, column-major) into `matrix`.
     */
    fun update(matrix: FloatArray): Boolean {
        if (!frameAvailable || released) return false
        frameAvailable = false
        return try {
            surfaceTexture.updateTexImage()
            surfaceTexture.getTransformMatrix(matrix)
            hasFrame = true
            true
        } catch (e: Exception) {
            false
        }
    }

    fun release() {
        released = true
        worker.execute {
            try {
                player?.release()
            } catch (e: Exception) {
            }
            player = null
            surface.release()
            surfaceTexture.release()
        }
        worker.shutdown()
    }
}
