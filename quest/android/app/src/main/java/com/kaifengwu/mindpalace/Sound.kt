package com.kaifengwu.mindpalace

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Handler
import android.os.Looper
import android.os.Process
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean

/**
 * platform.h's sound on the Quest: the microphone through AudioRecord at 16 kHz mono, sound files through
 * MediaPlayer, and streamed speech through an AudioTrack fed from its own thread. `handle` says which native object an
 * event is for.
 *
 * The microphone reads from VOICE_RECOGNITION, the source meant for a recognizer: no echo cancelling or noise
 * suppression that could blur the name, and the listener does not listen while a reply plays, so the agent's own
 * voice is not heard. `-micSource communication` reads VOICE_COMMUNICATION instead, to compare on the headset.
 */
object Sound {
    private const val ASK = 41
    private const val RATE = 16000
    /** Ms Momo's caption says why before the system asks, so the reason is read first. */
    private const val REASON_FIRST = 1500L

    private class Mic(val running: AtomicBoolean, val thread: Thread)

    private val mics = HashMap<Long, Mic>()
    private val players = HashMap<Long, MediaPlayer>()
    /** A stream's samples on their way to its thread, and whether it was told to stop. */
    private class Speech(val queue: LinkedBlockingQueue<ShortArray>, val stopped: AtomicBoolean)
    private val speeches = HashMap<Long, Speech>()
    /** Put on a stream's queue: nothing more comes. */
    private val END = ShortArray(0)
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
        microphoneAsking(handle)
        Handler(Looper.getMainLooper()).postDelayed({
            if (synchronized(this) { asking?.first == handle }) (activity as MainActivity).askPermission(Manifest.permission.RECORD_AUDIO, ASK)
        }, REASON_FIRST)
    }

    /** From MainActivity.onRequestPermissionsResult. */
    fun answered(code: Int, granted: Boolean) {
        if (code != ASK) return
        val waiting = synchronized(this) { asking.also { asking = null } } ?: return
        if (granted) start(waiting.first, waiting.second)
        else microphoneDenied(waiting.first)
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

    /** The frame thread only queues; the stream's own thread writes, so a write never waits on the track. */
    @JvmStatic
    fun openStream(rate: Int, handle: Long) {
        val speech = Speech(LinkedBlockingQueue(), AtomicBoolean(false))
        synchronized(this) { speeches[handle] = speech }
        Thread({ speak(rate, handle, speech) }, "speech").start()
    }

    @JvmStatic
    fun writeStream(handle: Long, samples: ShortArray) {
        synchronized(this) { speeches[handle] }?.queue?.offer(samples)
    }

    @JvmStatic
    fun finishStream(handle: Long) {
        synchronized(this) { speeches[handle] }?.queue?.offer(END)
    }

    @JvmStatic
    fun stopStream(handle: Long) {
        val speech = synchronized(this) { speeches[handle] } ?: return
        speech.stopped.set(true)
        speech.queue.offer(END)
    }

    /** Plays what is queued as it comes; once finished, waits for the playback head to reach the last frame written. */
    private fun speak(rate: Int, handle: Long, speech: Speech) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
        val least = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val track = try {
            AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
                )
                .setAudioFormat(
                    AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build()
                )
                .setTransferMode(AudioTrack.MODE_STREAM)
                .setBufferSizeInBytes(maxOf(least, rate / 5 * 2))
                .build()
        } catch (e: Exception) {
            null
        }
        if (track == null || track.state != AudioTrack.STATE_INITIALIZED) {
            track?.release()
            synchronized(this) { speeches.remove(handle) }
            played(handle, false)
            return
        }
        track.play()
        var written = 0L
        var toEnd = false
        try {
            feed@ while (!speech.stopped.get()) {
                val samples = speech.queue.take()
                if (samples === END) {
                    toEnd = true
                    break
                }
                var at = 0
                while (at < samples.size && !speech.stopped.get()) {
                    val n = track.write(samples, at, samples.size - at, AudioTrack.WRITE_NON_BLOCKING)
                    if (n < 0) break@feed
                    if (n == 0) Thread.sleep(5)
                    at += n
                }
                written += at
            }
            // A track that never reaches the end (a stalled device) is let go a couple of seconds after it should have.
            val deadline = System.nanoTime() + written * 1_000_000_000L / rate + 2_000_000_000L
            while (toEnd && !speech.stopped.get() && (track.playbackHeadPosition.toLong() and 0xffffffffL) < written && System.nanoTime() < deadline) {
                Thread.sleep(10)
            }
        } catch (e: InterruptedException) {
            toEnd = false
        }
        toEnd = toEnd && !speech.stopped.get()
        if (toEnd) {
            track.stop()
        } else {
            track.pause()
            track.flush()
        }
        track.release()
        synchronized(this) { speeches.remove(handle) }
        played(handle, toEnd)
    }

    @JvmStatic external fun heard(handle: Long, samples: ShortArray, count: Int)
    @JvmStatic external fun microphoneFailed(handle: Long, why: ByteArray)
    @JvmStatic external fun microphoneDenied(handle: Long)
    @JvmStatic external fun microphoneAsking(handle: Long)
    @JvmStatic external fun played(handle: Long, toEnd: Boolean)
}
