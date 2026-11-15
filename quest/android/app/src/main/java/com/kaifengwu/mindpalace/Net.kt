package com.kaifengwu.mindpalace

import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * platform.h's network on the Quest: OkHttp's WebSocket and calls. Native code calls in from any
 * thread and is called back on OkHttp's threads; `handle` says which native object an event is for.
 *
 * Text crosses as UTF-8 bytes, not as a String: JNI's own string conversion is "modified UTF-8",
 * which writes characters outside the basic plane (most emoji) in a form JSON readers reject.
 */
object Net {
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        // A socket is quiet for long stretches; the pings, not a read timeout, find one that died.
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    @JvmStatic
    fun openSocket(url: String, handle: Long): WebSocket? {
        val request = try {
            Request.Builder().url(url).build()
        } catch (e: IllegalArgumentException) {
            socketClosed(handle, "not an address: $url")
            return null
        }
        return client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) = socketOpened(handle)
            override fun onMessage(webSocket: WebSocket, text: String) = socketText(handle, text.toByteArray(Charsets.UTF_8))
            override fun onMessage(webSocket: WebSocket, bytes: ByteString) = socketText(handle, bytes.toByteArray())
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = socketClosed(handle, "closed by the service ($code)")
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = socketClosed(handle, t.message ?: t.toString())
        })
    }

    @JvmStatic
    fun send(socket: WebSocket, text: ByteArray): Boolean = socket.send(String(text, Charsets.UTF_8))

    @JvmStatic
    fun close(socket: WebSocket) {
        socket.close(1000, null)
    }

    /** `headers` alternates names and values. With `saveTo`, a successful reply's body goes to that file. */
    @JvmStatic
    fun fetch(method: String, url: String, headers: Array<String>, body: ByteArray, saveTo: String, timeoutMs: Long, handle: Long) {
        val builder = try {
            Request.Builder().url(url)
        } catch (e: IllegalArgumentException) {
            fetched(handle, 0, "", ByteArray(0), "not an address: $url")
            return
        }
        var type: MediaType? = null
        for (i in 0 until headers.size - 1 step 2) {
            builder.header(headers[i], headers[i + 1])
            if (headers[i].equals("Content-Type", ignoreCase = true)) type = headers[i + 1].toMediaTypeOrNull()
        }
        val sendsBody = method == "POST" || method == "PUT" || method == "PATCH"
        builder.method(method, if (sendsBody) body.toRequestBody(type) else null)
        val timed = client.newBuilder()
            .callTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .build()
        timed.newCall(builder.build()).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) = fetched(handle, 0, "", ByteArray(0), e.message ?: e.toString())

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    val contentType = it.header("Content-Type") ?: ""
                    if (saveTo.isEmpty() || !it.isSuccessful) {
                        fetched(handle, it.code, contentType, it.body?.bytes() ?: ByteArray(0), "")
                        return
                    }
                    val file = File(saveTo)
                    val part = File("$saveTo.part")
                    val error = try {
                        file.parentFile?.mkdirs()
                        part.outputStream().use { out -> it.body?.byteStream()?.copyTo(out) }
                        if (part.renameTo(file)) "" else "could not write $saveTo"
                    } catch (e: IOException) {
                        part.delete()
                        "could not write $saveTo"
                    }
                    fetched(handle, it.code, contentType, ByteArray(0), error)
                }
            }
        })
    }

    @JvmStatic external fun socketOpened(handle: Long)
    @JvmStatic external fun socketText(handle: Long, text: ByteArray)
    @JvmStatic external fun socketClosed(handle: Long, why: String)
    @JvmStatic external fun fetched(handle: Long, status: Int, contentType: String, body: ByteArray, error: String)
}
