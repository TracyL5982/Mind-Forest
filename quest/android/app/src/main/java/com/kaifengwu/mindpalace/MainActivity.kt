package com.kaifengwu.mindpalace

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import java.io.File

/**
 * The Quest app's one activity. Everything happens in native code (the
 * OpenXR frame loop in main.cpp); this starts it and hands it what it needs
 * from Android: launch flags, and where the media and the app's own files are.
 *
 * Launch flags are the visionOS app's, passed as one string:
 *   adb shell am start -n com.kaifengwu.mindpalace.ocean/com.kaifengwu.mindpalace.MainActivity --es args "-demo -fps"
 *
 * Media (the visionOS bundle's resources: ocean.json, clips/, works/) is not
 * inside the APK. It is copied once to the app's external files folder by
 * quest/tools/push_media.sh, so installing a new build takes seconds.
 */
class MainActivity : Activity() {
    companion object {
        init {
            System.loadLibrary("ocean")
        }
    }

    private external fun nativeStart(args: Array<String>, mediaDir: String, dataDir: String, outDir: String)
    private external fun nativeStop()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val args = (intent.getStringExtra("args") ?: "").trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        val external = getExternalFilesDir(null) ?: filesDir
        val media = File(external, "media")
        val out = File(external, "out").apply { mkdirs() }
        nativeStart(args.toTypedArray(), media.absolutePath, filesDir.absolutePath, out.absolutePath)
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
