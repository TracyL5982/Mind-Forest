package com.kaifengwu.mindpalace

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import android.graphics.Typeface
import android.text.Layout
import android.text.StaticLayout
import android.text.TextDirectionHeuristics
import android.text.TextPaint
import android.text.TextUtils
import android.util.Log
import java.nio.ByteBuffer
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * The Quest's side of core/canvas.h: measures text and draws a canvas's
 * commands with android.graphics. Called from native code
 * (canvas_android.cpp) on the app's frame thread, never the UI thread;
 * nothing here touches a view.
 *
 * It must draw what desktop/canvas_mac.mm draws for the same commands. The
 * rules they share are written in canvas.h (`platform::layoutText`): lines
 * are a fixed height apart, words stand on the bottom of their line, a
 * line's width leaves out the spaces it ends with, and text that is cut
 * short ends in an ellipsis.
 */
object CanvasRenderer {
    private const val TAG = "ocean"

    // Canvas::Op in canvas.h.
    private const val SAVE = 1
    private const val RESTORE = 2
    private const val CLIP = 3
    private const val FILL_COLOR = 4
    private const val STROKE_COLOR = 5
    private const val LINE_WIDTH = 6
    private const val LINE_JOIN = 7
    private const val LINE_CAP = 8
    private const val LINE_DASH = 9
    private const val MOVE = 10
    private const val LINE = 11
    private const val CLOSE = 12
    private const val STROKE_PATH = 13
    private const val FILL_PATH = 14
    private const val FILL_RECT = 15
    private const val COPY_RECT = 16
    private const val STROKE_RECT = 17
    private const val FILL_ELLIPSE = 18
    private const val STROKE_ELLIPSE = 19
    private const val IMAGE = 20
    private const val TEXT = 21

    private const val ELLIPSIS = "…"

    // MARK: Fonts

    // (Text is measured on the frame thread while pictures are drawn on another: this is shared between them.)
    private val typefaces = java.util.concurrent.ConcurrentHashMap<Int, Typeface>()

    /**
     * A font by its face code (faceCode in canvas.h): one of Font::Weight's four in the low two bits
     * (0 regular, 1 medium, 2 semibold, 3 bold), 4 for the serif, 8 for italics, 16 for fixed width.
     */
    private fun typeface(face: Int): Typeface = typefaces.getOrPut(face) {
        val w = when (face and 3) {
            1 -> 500
            2 -> 600
            3 -> 700
            else -> 400
        }
        val family = if (face and 16 != 0) Typeface.MONOSPACE else if (face and 4 != 0) Typeface.SERIF else Typeface.DEFAULT
        Typeface.create(family, w, face and 8 != 0)
    }

    /**
     * A paint that measures and draws the same way at any size: no hinting, glyphs placed between pixels.
     * `kern`, when given, is UIKit's: so many pixels after every character; given as 0, it turns the
     * font's own pair kerning off (see TextAttributes in canvas.h).
     */
    private fun textPaint(size: Float, weight: Int, kerned: Boolean, kern: Float): TextPaint {
        val paint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG or Paint.LINEAR_TEXT_FLAG)
        paint.typeface = typeface(weight)
        paint.textSize = size
        paint.hinting = Paint.HINTING_OFF
        if (kerned) {
            paint.letterSpacing = if (size > 0f) kern / size else 0f      // in ems
            if (kern == 0f) paint.fontFeatureSettings = "'kern' 0"
        }
        return paint
    }

    /** ascent, descent, leading: all positive, pixels. */
    @JvmStatic
    fun fontMetrics(size: Float, weight: Int): FloatArray {
        val m = textPaint(size, weight, false, 0f).fontMetrics
        return floatArrayOf(-m.ascent, m.descent, m.leading)
    }

    // MARK: Text

    private class Line(
        val shown: String,          // what is drawn: its words, and an ellipsis if it was cut
        val y: Float,
        val width: Float,
        val height: Float,
        val baseline: Float,
        val start: Int,             // the characters of the string it shows, before any ellipsis
        val end: Int,
        val truncated: Boolean,
        val carets: FloatArray?,
    )

    private class Frame(val width: Float, val height: Float, val lines: List<Line>)

    /**
     * Lays text out. StaticLayout only says where lines break and where an ellipsis goes;
     * where each line stands is worked out here, by canvas.h's rule, so it is the Mac's too.
     */
    private fun lay(text: String, paint: TextPaint, kernShift: Float, lineHeight: Float, width: Float, maxLines: Int, carets: Boolean): Frame {
        val m = paint.fontMetrics
        val natural = -m.ascent + m.descent + m.leading
        val advance = if (lineHeight > 0f) lineHeight else natural
        val lines = ArrayList<Line>()
        if (text.isEmpty()) {
            // No words still take a line.
            lines.add(Line("", 0f, 0f, advance, advance - m.descent, 0, 0, false, if (carets) floatArrayOf(0f) else null))
            return Frame(0f, advance, lines)
        }
        val unlimited = !(width < 1e6f)
        if (unlimited && text.indexOf('\n') < 0) {
            // One line with nothing to wrap it: no line breaker is needed, only its width. Most of what is
            // measured is this (a title, a label, a tag), and a step that opens a tree measures dozens.
            var shownEnd = text.length
            while (shownEnd > 0 && text[shownEnd - 1] == ' ') shownEnd--
            val w = paint.measureText(text, 0, shownEnd)
            var edges: FloatArray? = null
            if (carets) {
                edges = FloatArray(text.length + 1)
                val advances = FloatArray(max(shownEnd, 1))
                if (shownEnd > 0) paint.getTextWidths(text, 0, shownEnd, advances)
                var x = 0f
                for (k in 0..text.length) {
                    val at = min(k, shownEnd)
                    if (k in 1..shownEnd) x += advances[k - 1]
                    edges[k] = min(max(0f, x - (if (at > 0) kernShift else 0f)), w)
                }
            }
            lines.add(Line(text.substring(0, shownEnd), 0f, w, advance, advance - m.descent, 0, text.length, false, edges))
            return Frame(w, advance, lines)
        }
        val wrap = if (unlimited) 1 shl 24 else max(1, floor(width + 0.01f).toInt())
        val builder = StaticLayout.Builder.obtain(text, 0, text.length, paint, wrap)
            .setAlignment(Layout.Alignment.ALIGN_NORMAL)
            .setTextDirection(TextDirectionHeuristics.LTR)
            .setIncludePad(false)
            .setBreakStrategy(Layout.BREAK_STRATEGY_SIMPLE)
            .setHyphenationFrequency(Layout.HYPHENATION_FREQUENCY_NONE)
        if (maxLines > 0 && !unlimited) builder.setMaxLines(maxLines).setEllipsize(TextUtils.TruncateAt.END)
        val layout = builder.build()
        val count = if (maxLines > 0) min(layout.lineCount, maxLines) else layout.lineCount
        var widest = 0f
        for (i in 0 until count) {
            val start = layout.getLineStart(i)
            val cut = layout.getEllipsisCount(i) > 0
            val end: Int            // the last character that belongs to the line, and one more
            val shownEnd: Int       // the last character that shows, and one more
            val shown: String
            if (cut) {
                end = min(text.length, start + layout.getEllipsisStart(i))
                shownEnd = end
                shown = text.substring(start, end) + ELLIPSIS
            } else {
                end = layout.getLineEnd(i)
                shownEnd = min(end, max(start, layout.getLineVisibleEnd(i)))
                shown = text.substring(start, shownEnd)
            }
            val w = paint.measureText(shown)
            var edges: FloatArray? = null
            if (carets) {
                // Where each character begins, and where the last ends; the spaces a line ends with all stand at its end.
                // Every character's advance in one pass over the line (asking for each caret by itself
                // shapes the whole line again every time, which a paragraph cannot afford on a frame).
                edges = FloatArray(end - start + 1)
                val n = shownEnd - start
                val advances = FloatArray(max(n, 1))
                if (n > 0) paint.getTextWidths(text, start, shownEnd, advances)
                var x = 0f
                for (k in 0..(end - start)) {
                    val at = min(k, n)
                    if (k in 1..n) x += advances[k - 1]
                    edges[k] = min(max(0f, x - (if (at > 0) kernShift else 0f)), w)
                }
            }
            lines.add(Line(shown, i * advance, w, advance, i * advance + advance - m.descent, start, end, cut, edges))
            widest = max(widest, w)
        }
        return Frame(widest, count * advance, lines)
    }

    /**
     * Android puts half of a letter spacing before each glyph and half after; UIKit puts all of it after.
     * Drawing this much to the left makes the first glyph start where UIKit's does.
     */
    private fun kernShift(kerned: Boolean, kern: Float): Float = if (kerned) kern / 2 else 0f

    /**
     * What comes back: width, height, the number of lines; then for each line x, y, width, height,
     * baseline, start, end, truncated (0 or 1), the number of carets, and the carets.
     */
    @JvmStatic
    fun layoutText(text: String, size: Float, weight: Int, kerned: Boolean, kern: Float, lineHeight: Float, width: Float, maxLines: Int, carets: Boolean): FloatArray {
        val frame = try {
            lay(text, textPaint(size, weight, kerned, kern), kernShift(kerned, kern), lineHeight, width, maxLines, carets)
        } catch (e: Throwable) {
            Log.e(TAG, "[canvas] layoutText failed", e)
            return floatArrayOf(0f, 0f, 0f)
        }
        var n = 3
        for (line in frame.lines) n += 9 + (line.carets?.size ?: 0)
        val out = FloatArray(n)
        out[0] = frame.width
        out[1] = frame.height
        out[2] = frame.lines.size.toFloat()
        var i = 3
        for (line in frame.lines) {
            out[i] = 0f
            out[i + 1] = line.y
            out[i + 2] = line.width
            out[i + 3] = line.height
            out[i + 4] = line.baseline
            out[i + 5] = line.start.toFloat()
            out[i + 6] = line.end.toFloat()
            out[i + 7] = if (line.truncated) 1f else 0f
            val edges = line.carets
            out[i + 8] = (edges?.size ?: 0).toFloat()
            i += 9
            if (edges != null) {
                edges.copyInto(out, i)
                i += edges.size
            }
        }
        return out
    }

    // MARK: Drawing

    /** What CGContext keeps and saveGState saves, besides the clip. */
    private class State(
        var fill: Int = Color.BLACK,
        var stroke: Int = Color.BLACK,
        var lineWidth: Float = 1f,
        var join: Paint.Join = Paint.Join.MITER,
        var cap: Paint.Cap = Paint.Cap.BUTT,
        var dash: FloatArray? = null,
        var phase: Float = 0f,
    ) {
        fun copy() = State(fill, stroke, lineWidth, join, cap, dash, phase)
    }

    /**
     * Draws a canvas's commands into a `width` x `height` bitmap and copies its pixels to `out`
     * (R, G, B, A bytes, premultiplied, the top row first). `images` are pictures in that same
     * form, each `imageSizes[2i]` x `imageSizes[2i + 1]`. False if it could not be done.
     */
    @JvmStatic
    fun rasterize(
        width: Int, height: Int, scale: Float, opaque: Boolean, commands: FloatArray, strings: Array<String>,
        images: Array<ByteBuffer?>, imageSizes: IntArray, out: ByteBuffer,
    ): Boolean {
        var bitmap: Bitmap? = null
        val bitmaps = arrayOfNulls<Bitmap>(images.size)
        try {
            val target = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            bitmap = target
            if (opaque) target.eraseColor(Color.BLACK)
            val canvas = Canvas(target)
            canvas.scale(scale, scale)

            val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
            // UIRectFill: the color in place of what was there, its own transparency included.
            val copy = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.FILL
                xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC)
            }
            val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.STROKE
                strokeMiter = 10f           // CoreGraphics' miter limit
            }
            val picture = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
            val path = Path()
            val rect = RectF()
            var state = State()
            val saved = ArrayList<State>()

            var i = 0
            fun next(): Float = if (i < commands.size) commands[i++] else 0f
            fun readRect() {
                val x = next()
                val y = next()
                val w = next()
                val h = next()
                rect.set(x, y, x + w, y + h)
            }
            fun readColor(): Int {
                val r = next().coerceIn(0f, 1f)
                val g = next().coerceIn(0f, 1f)
                val b = next().coerceIn(0f, 1f)
                val a = next().coerceIn(0f, 1f)
                return Color.argb(a, r, g, b)
            }
            fun filling(): Paint {
                fill.color = state.fill
                return fill
            }
            fun stroking(): Paint {
                stroke.color = state.stroke
                stroke.strokeWidth = state.lineWidth
                stroke.strokeJoin = state.join
                stroke.strokeCap = state.cap
                val dash = state.dash
                stroke.pathEffect = if (dash != null) DashPathEffect(dash, state.phase) else null
                return stroke
            }

            while (i < commands.size) {
                when (next().toInt()) {
                    SAVE -> {
                        canvas.save()
                        saved.add(state.copy())
                    }
                    RESTORE -> {
                        if (canvas.saveCount > 1) canvas.restore()
                        if (saved.isNotEmpty()) state = saved.removeAt(saved.size - 1)
                    }
                    CLIP -> {
                        readRect()
                        canvas.clipRect(rect)
                    }
                    FILL_COLOR -> state.fill = readColor()
                    STROKE_COLOR -> state.stroke = readColor()
                    LINE_WIDTH -> state.lineWidth = next()
                    LINE_JOIN -> state.join = when (next().toInt()) {
                        1 -> Paint.Join.ROUND
                        2 -> Paint.Join.BEVEL
                        else -> Paint.Join.MITER
                    }
                    LINE_CAP -> state.cap = when (next().toInt()) {
                        1 -> Paint.Cap.ROUND
                        2 -> Paint.Cap.SQUARE
                        else -> Paint.Cap.BUTT
                    }
                    LINE_DASH -> {
                        state.phase = next()
                        val n = next().toInt()
                        val lengths = FloatArray(max(0, n)) { next() }
                        state.dash = when {
                            lengths.isEmpty() || lengths.all { it <= 0f } -> null
                            lengths.size % 2 == 0 -> lengths
                            else -> lengths + lengths       // an odd count repeats, as CoreGraphics reads it
                        }
                    }
                    MOVE -> {
                        val x = next()
                        val y = next()
                        path.moveTo(x, y)
                    }
                    LINE -> {
                        val x = next()
                        val y = next()
                        path.lineTo(x, y)
                    }
                    CLOSE -> path.close()
                    STROKE_PATH -> {
                        canvas.drawPath(path, stroking())
                        path.reset()
                    }
                    FILL_PATH -> {
                        canvas.drawPath(path, filling())
                        path.reset()
                    }
                    FILL_RECT -> {
                        readRect()
                        canvas.drawRect(rect, filling())
                    }
                    COPY_RECT -> {
                        readRect()
                        copy.color = state.fill
                        canvas.drawRect(rect, copy)
                    }
                    STROKE_RECT -> {
                        readRect()
                        canvas.drawRect(rect, stroking())
                    }
                    FILL_ELLIPSE -> {
                        readRect()
                        canvas.drawOval(rect, filling())
                    }
                    STROKE_ELLIPSE -> {
                        readRect()
                        canvas.drawOval(rect, stroking())
                    }
                    IMAGE -> {
                        val index = next().toInt()
                        readRect()
                        if (index in bitmaps.indices) {
                            var made = bitmaps[index]
                            if (made == null) {
                                val buffer = images[index]
                                val w = imageSizes.getOrElse(index * 2) { 0 }
                                val h = imageSizes.getOrElse(index * 2 + 1) { 0 }
                                if (buffer != null && w > 0 && h > 0 && buffer.capacity() >= w * h * 4) {
                                    made = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                                    buffer.rewind()
                                    made.copyPixelsFromBuffer(buffer)
                                    bitmaps[index] = made
                                }
                            }
                            if (made != null) canvas.drawBitmap(made, null, rect, picture)
                        }
                    }
                    TEXT -> {
                        val index = next().toInt()
                        val x = next()
                        val y = next()
                        val w = next()
                        val maxLines = next().toInt()
                        val size = next()
                        val weight = next().toInt()
                        val kerned = next() != 0f
                        val kern = next()
                        val lineHeight = next()
                        val color = readColor()
                        if (index in strings.indices) {
                            val paint = textPaint(size, weight, kerned, kern)
                            paint.color = color
                            val shift = kernShift(kerned, kern)
                            val frame = lay(strings[index], paint, shift, lineHeight, w, maxLines, false)
                            for (line in frame.lines) {
                                if (line.shown.isNotEmpty()) canvas.drawText(line.shown, x - shift, y + line.baseline, paint)
                            }
                        }
                    }
                    else -> {
                        // Not a command: the list can't be read any further.
                        Log.e(TAG, "[canvas] unknown command at ${i - 1}")
                        i = commands.size
                    }
                }
            }

            out.rewind()
            target.copyPixelsToBuffer(out)
            return true
        } catch (e: Throwable) {
            Log.e(TAG, "[canvas] rasterize failed", e)
            return false
        } finally {
            for (b in bitmaps) b?.recycle()
            bitmap?.recycle()
        }
    }
}
