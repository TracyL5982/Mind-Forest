package com.kaifengwu.mindpalace

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Process
import java.util.concurrent.atomic.AtomicBoolean

/**
 * platform.h's sound on the Quest: the microphone through AudioRecord at 16 kHz mono, and sound files through
 * MediaPlayer. `handle` says which native object an event is for.
 *
 * The microphone reads from VOICE_RECOGNITION, the source meant for a recognizer: no echo cancelling or noise
 * suppression that could blur the name, and the listener does not listen while a reply plays, so the agent's own
 * voice is not heard. `-micSource communication` reads VOICE_COMMUNICATION instead, to compare on the headset.
 */
object Sound {
    private const val ASK = 41
    private const val RATE = 16000

    private class Mic(val running: AtomicBoolean, val thread: Thread)

    private val mics = HashMap<Long, Mic>()
    private val players = HashMap<Long, MediaPlayer>()
    /** A microphone waiting for the user's leave: its handle and source. */
    private var asking: Pair<Long, Int>? = null

    @JvmStatic
    fun openMicrophone(activity: Activity, handle: Long, communication: Boolean) {
        val source = if (communication) MediaRecorder.AudioSource.VOICE_COMMUNICATION else MediaRecorder.AudioSource.VOICE_RECOGNITION
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            start(handle, source)
            return
        }
        synchronized(this) { asking = handle to source }
        activity.runOnUiThread { activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), ASK) }
    }

    /** From MainActivity.onRequestPermissionsResult. */
    fun answered(code: Int, granted: Boolean) {
        if (code != ASK) return
        val waiting = synchronized(this) { asking.also { asking = null } } ?: return
        if (granted) start(waiting.first, waiting.second)
        else microphoneFailed(waiting.first, "the microphone is not allowed for this app".toByteArray(Charsets.UTF_8))
    }

    /** Everything about the recorder happens on its own thread, so neither making it nor reading it costs a frame. */
    private fun start(handle: Long, source: Int) {
        val running = AtomicBoolean(true)
        val thread = Thread({
            Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
            val least = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            val record = try {
                AudioRecord(source, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(least, RATE * 2))
            } catch (e: Exception) {
                microphoneFailed(handle, "AudioRecord: $e".toByteArray(Charsets.UTF_8))
                return@Thread
            }
            if (record.state != AudioRecord.STATE_INITIALIZED) {
                record.release()
                microphoneFailed(handle, "AudioRecord did not start".toByteArray(Charsets.UTF_8))
                return@Thread
            }
            record.startRecording()
            val piece = ShortArray(RATE / 10)
            while (running.get()) {
                val n = record.read(piece, 0, piece.size)
                if (n > 0) {
                    heard(handle, piece, n)
                } else if (n < 0) {
                    microphoneFailed(handle, "AudioRecord.read gave $n".toByteArray(Charsets.UTF_8))
                    break
                }
            }
            record.stop()
            record.release()
        }, "microphone")
        synchronized(this) { mics[handle] = Mic(running, thread) }
        thread.start()
    }

    /** Returns once the microphone's thread has ended, so nothing more is heard. */
    @JvmStatic
    fun closeMicrophone(handle: Long) {
        val mic = synchronized(this) {
            if (asking?.first == handle) asking = null
            mics.remove(handle)
        } ?: return
        mic.running.set(false)
        if (Thread.currentThread() != mic.thread) mic.thread.join()
    }

    @JvmStatic
    fun play(activity: Activity, path: String, handle: Long) {
        activity.runOnUiThread {
            val player = MediaPlayer()
            try {
                player.setAudioAttributes(
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
                )
                player.setDataSource(path)
                player.setOnPreparedListener { it.start() }
                player.setOnCompletionListener { finish(handle, true) }
                player.setOnErrorListener { _, _, _ -> finish(handle, false); true }
                players[handle] = player
                player.prepareAsync()
            } catch (e: Exception) {
                players.remove(handle)
                player.release()
                played(handle, false)
            }
        }
    }

    @JvmStatic
    fun stop(activity: Activity, handle: Long) {
        activity.runOnUiThread { finish(handle, false) }
    }

    private fun finish(handle: Long, toEnd: Boolean) {
        val player = players.remove(handle) ?: return
        player.release()
        played(handle, toEnd)
    }

    @JvmStatic external fun heard(handle: Long, samples: ShortArray, count: Int)
    @JvmStatic external fun microphoneFailed(handle: Long, why: ByteArray)
    @JvmStatic external fun played(handle: Long, toEnd: Boolean)
}
