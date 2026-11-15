package com.kaifengwu.mindpalace

import android.app.Activity
import android.content.Context
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout

/**
 * The system keyboard, for typing to the agent. The scene draws nothing of Android's, so a field the user never
 * sees holds the text and asks the system for its keyboard, which the headset shows over the app. Each change
 * and the end are handed to native code as UTF-8 bytes (see Net.kt for why not a String).
 */
object Keyboard {
    private var field: EditText? = null
    private var open = false

    @JvmStatic
    fun show(activity: Activity, text: String) {
        activity.runOnUiThread {
            val f = field ?: make(activity)
            open = true
            f.setText(text)
            f.setSelection(text.length)
            f.requestFocus()
            val imm = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
            imm.showSoftInput(f, InputMethodManager.SHOW_FORCED)
        }
    }

    @JvmStatic
    fun hide(activity: Activity) {
        activity.runOnUiThread { close(activity, false) }
    }

    private fun close(activity: Activity, sent: Boolean) {
        val f = field ?: return
        if (!open) return
        open = false
        val imm = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        imm.hideSoftInputFromWindow(f.windowToken, 0)
        f.clearFocus()
        done(f.text.toString().toByteArray(Charsets.UTF_8), sent)
    }

    private fun make(activity: Activity): EditText {
        val f = EditText(activity).apply {
            isSingleLine = true
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            imeOptions = EditorInfo.IME_ACTION_SEND
            alpha = 0f
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                override fun afterTextChanged(s: Editable?) {
                    if (open) typed((s?.toString() ?: "").toByteArray(Charsets.UTF_8))
                }
            })
            setOnEditorActionListener { _, action, _ ->
                if (action == EditorInfo.IME_ACTION_SEND || action == EditorInfo.IME_ACTION_DONE) {
                    close(activity, true)
                    true
                } else {
                    false
                }
            }
            setOnFocusChangeListener { _, focused -> if (!focused && open) close(activity, false) }
        }
        val holder = FrameLayout(activity)
        holder.addView(f, FrameLayout.LayoutParams(1, 1))
        activity.addContentView(holder, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        field = f
        return f
    }

    @JvmStatic external fun typed(text: ByteArray)
    @JvmStatic external fun done(text: ByteArray, sent: Boolean)
}
