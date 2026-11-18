package com.kaifengwu.mindpalace

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.AssetManager
import android.net.Uri
import android.os.Bundle
import java.io.File

/**
 * The Quest app's one activity. Everything happens in native code (the
 * OpenXR frame loop in main.cpp); this starts it and hands it what it needs
 * from Android: launch flags, and where the media and the app's own files are.
 *
 * Launch flags are passed as one string:
 *   adb shell am start -n com.kaifengwu.mindpalace.ocean/com.kaifengwu.mindpalace.MainActivity --es args "-demo -fps"
 *
 * Media (the library: ocean.json, clips/, works/) is not
 * inside a developer build's APK. It is copied once to the app's external files
 * folder by quest/tools/push_media.sh, so installing a new build takes seconds.
 * The judging build (quest/tools/judge.sh) carries it inside the APK, and reads
 * it from there; it also joins its own service, BuildConfig.SERVER.
 */
class MainActivity : Activity() {
    companion object {
        init {
            System.loadLibrary("ocean")
        }
    }

    private external fun nativeStart(
        args: Array<String>, mediaDir: String, assets: AssetManager, dataDir: String, outDir: String, server: String, appKey: String
    )
    private external fun nativeStop()
    private external fun nativeRoomPermission(granted: Boolean)

    private val scenePermission = "com.oculus.permission.USE_SCENE"

    /**
     * The system's questions, one at a time: Android cancels a request made while another is up (it answers it at once,
     * with nothing granted), so the microphone and the room would each read as refused if they met. A question asked
     * while one is up waits for its answer.
     */
    private val waitingQuestions = ArrayDeque<Pair<String, Int>>()
    private var questionUp = false

    fun askPermission(permission: String, requestCode: Int) {
        runOnUiThread {
            if (questionUp) {
                waitingQuestions.addLast(permission to requestCode)
            } else {
                questionUp = true
                requestPermissions(arrayOf(permission), requestCode)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val args = (intent.getStringExtra("args") ?: "").trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        val external = getExternalFilesDir(null) ?: filesDir
        val media = File(external, "media")
        val out = File(external, "out").apply { mkdirs() }
        copyListenerModel()
        CanvasRenderer.fontsDir = File(media, "fonts").absolutePath
        Media.assets = assets
        nativeStart(args.toTypedArray(), media.absolutePath, assets, filesDir.absolutePath, out.absolutePath, BuildConfig.SERVER, BuildConfig.APP_KEY)
    }

    /** The keyword model comes inside the APK; the spotter reads files, so it is copied to the app's own files once per build. */
    private fun copyListenerModel() {
        val into = File(filesDir, "kws").apply { mkdirs() }
        val stamp = File(into, "installed")
        val build = packageManager.getPackageInfo(packageName, 0).lastUpdateTime.toString()
        if (stamp.exists() && stamp.readText() == build) return
        for (name in assets.list("kws") ?: emptyArray()) {
            assets.open("kws/$name").use { from -> File(into, name).outputStream().use { from.copyTo(it) } }
        }
        stamp.writeText(build)
    }

    /**
     * Called from native code, once, when someone is wearing the headset (a hand has been seen): asks
     * whether the app may see the room (the headset's scene model), which is the user's to share. Until
     * it is allowed the scene sits at an assumed desk; when it is, the native side reads the room.
     * It is not asked at launch: the system's dialog holds the app back until it is answered, and a
     * headset lying on a desk for an automated run has nobody to answer it.
     */
    @Suppress("unused")
    fun askForRoom() {
        runOnUiThread {
            if (checkSelfPermission(scenePermission) != PackageManager.PERMISSION_GRANTED) askPermission(scenePermission, 1)
        }
    }

    /** The microphone's answer goes to Sound (its own request code); the room's to the native side. Then the next question. */
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        Sound.answered(requestCode, grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED)
        val at = permissions.indexOf(scenePermission)
        if (at >= 0 && at < grantResults.size) nativeRoomPermission(grantResults[at] == PackageManager.PERMISSION_GRANTED)
        questionUp = false
        waitingQuestions.removeFirstOrNull()?.let { (permission, code) -> askPermission(permission, code) }
    }

    /** Called from native code when a run is over (`-quitAfter`). */
    @Suppress("unused")
    fun finishFromNative() {
        runOnUiThread { finishAndRemoveTask() }
    }

    /** Called from native code: a link note's "Open" was pinched. The system's browser comes up over the app. */
    @Suppress("unused")
    fun openUrl(url: String) {
        runOnUiThread {
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (e: Exception) {
                android.util.Log.w("ocean", "[host] could not open $url: $e")
            }
        }
    }

    override fun onDestroy() {
        nativeStop()
        super.onDestroy()
        // The native side keeps process-wide state (flags read once, GL
        // objects): the next launch gets a fresh process.
        android.os.Process.killProcess(android.os.Process.myPid())
    }
}
