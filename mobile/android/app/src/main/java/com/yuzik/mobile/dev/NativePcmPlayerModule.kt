package com.yuzik.mobile.dev

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

class NativePcmPlayerModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  companion object {
    private const val DEFAULT_MIN_BUFFER_MS = 480
    private const val MAX_MIN_BUFFER_MS = 2000
    private const val TRACK_BUFFER_MS = 2000
  }

  private val executor = Executors.newSingleThreadExecutor()
  private val mainHandler = Handler(Looper.getMainLooper())
  private val generation = AtomicInteger(0)
  private val trackLock = Any()
  private var audioTrack: AudioTrack? = null
  private var currentSampleRate: Int? = null
  private var pendingPlaySamples = 0
  private var delayedStartRunnable: Runnable? = null

  override fun getName(): String = "NativePcmPlayer"

  @ReactMethod
  fun pushFloat32Pcm(
    base64Pcm: String,
    sampleRate: Int,
    minBufferMs: Int,
    promise: Promise
  ) {
    if (sampleRate <= 0) {
      promise.reject("E_PCM_SAMPLE_RATE", "Sample rate must be greater than zero.")
      return
    }

    val pcmBytes = try {
      Base64.decode(base64Pcm, Base64.NO_WRAP)
    } catch (error: IllegalArgumentException) {
      promise.reject("E_PCM_BASE64", "PCM payload is not valid base64.", error)
      return
    }

    if (pcmBytes.isEmpty()) {
      promise.resolve(null)
      return
    }

    if (pcmBytes.size % 4 != 0) {
      promise.reject("E_PCM_ALIGNMENT", "Float32 PCM payload must be 4-byte aligned.")
      return
    }

    val floats = FloatArray(pcmBytes.size / 4)
    ByteBuffer.wrap(pcmBytes)
      .order(ByteOrder.LITTLE_ENDIAN)
      .asFloatBuffer()
      .get(floats)
    sanitizeSamples(floats)

    val writeGeneration = generation.get()
    val effectiveMinBufferMs = normalizeMinBufferMs(minBufferMs)
    executor.execute {
      try {
        if (writeGeneration != generation.get()) {
          promise.resolve(null)
          return@execute
        }

        val track = ensureTrack(sampleRate)
        val writtenSamples = track.write(floats, 0, floats.size, AudioTrack.WRITE_BLOCKING)

        if (writtenSamples < 0) {
          throw IllegalStateException("AudioTrack.write failed with code $writtenSamples.")
        }

        maybeStartPlayback(track, sampleRate, effectiveMinBufferMs, writtenSamples, writeGeneration)
        promise.resolve(null)
      } catch (error: Exception) {
        promise.reject("E_PCM_WRITE", "Failed to write PCM audio.", error)
      }
    }
  }

  @ReactMethod
  fun reset(promise: Promise) {
    generation.incrementAndGet()
    executor.execute {
      try {
        synchronized(trackLock) {
          audioTrack?.pause()
          audioTrack?.flush()
          audioTrack?.play()
        }
        promise.resolve(null)
      } catch (error: Exception) {
        promise.reject("E_PCM_RESET", "Failed to reset PCM audio.", error)
      }
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    generation.incrementAndGet()
    executor.execute {
      try {
        releaseTrack()
        promise.resolve(null)
      } catch (error: Exception) {
        promise.reject("E_PCM_STOP", "Failed to stop PCM audio.", error)
      }
    }
  }

  override fun invalidate() {
    generation.incrementAndGet()
    executor.execute {
      releaseTrack()
      executor.shutdown()
    }
    super.invalidate()
  }

  private fun ensureTrack(sampleRate: Int): AudioTrack {
    synchronized(trackLock) {
      val existingTrack = audioTrack
      if (existingTrack != null && currentSampleRate == sampleRate) {
        return existingTrack
      }

      releaseTrack()
      pendingPlaySamples = 0

      val minBufferSize = AudioTrack.getMinBufferSize(
        sampleRate,
        AudioFormat.CHANNEL_OUT_MONO,
        AudioFormat.ENCODING_PCM_FLOAT
      )
      val bufferSize = if (minBufferSize > 0) {
        maxOf(minBufferSize, sampleRate * 4 * TRACK_BUFFER_MS / 1000)
      } else {
        sampleRate * 4 * TRACK_BUFFER_MS / 1000
      }
      val format = AudioFormat.Builder()
        .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
        .setSampleRate(sampleRate)
        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
        .build()
      val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()

      val nextTrack = AudioTrack(
        attributes,
        format,
        bufferSize,
        AudioTrack.MODE_STREAM,
        AudioManager.AUDIO_SESSION_ID_GENERATE
      )

      if (nextTrack.state != AudioTrack.STATE_INITIALIZED) {
        nextTrack.release()
        throw IllegalStateException("AudioTrack failed to initialize.")
      }

      audioTrack = nextTrack
      currentSampleRate = sampleRate
      return nextTrack
    }
  }

  private fun releaseTrack() {
    synchronized(trackLock) {
      cancelDelayedStartLocked()
      audioTrack?.let { track ->
        try {
          if (track.playState != AudioTrack.PLAYSTATE_STOPPED) {
            track.stop()
          }
        } catch (_: IllegalStateException) {
          // Track may already be stopped or uninitialized.
        } finally {
          track.release()
        }
      }
      audioTrack = null
      currentSampleRate = null
      pendingPlaySamples = 0
    }
  }

  private fun normalizeMinBufferMs(minBufferMs: Int): Int =
    when {
      minBufferMs <= 0 -> DEFAULT_MIN_BUFFER_MS
      minBufferMs > MAX_MIN_BUFFER_MS -> MAX_MIN_BUFFER_MS
      else -> minBufferMs
    }

  private fun sanitizeSamples(samples: FloatArray) {
    for (index in samples.indices) {
      val sample = samples[index]
      samples[index] = when {
        !java.lang.Float.isFinite(sample) -> 0f
        sample > 1f -> 1f
        sample < -1f -> -1f
        else -> sample
      }
    }
  }

  private fun maybeStartPlayback(
    track: AudioTrack,
    sampleRate: Int,
    minBufferMs: Int,
    writtenSamples: Int,
    writeGeneration: Int
  ) {
    synchronized(trackLock) {
      if (audioTrack !== track || writeGeneration != generation.get()) {
        return
      }

      if (track.playState == AudioTrack.PLAYSTATE_PLAYING) {
        return
      }

      pendingPlaySamples += writtenSamples
      val minBufferSamples = sampleRate * minBufferMs / 1000
      if (pendingPlaySamples >= minBufferSamples) {
        cancelDelayedStartLocked()
        track.play()
        pendingPlaySamples = 0
        return
      }

      scheduleDelayedStartLocked(writeGeneration, minBufferMs)
    }
  }

  private fun scheduleDelayedStartLocked(writeGeneration: Int, minBufferMs: Int) {
    if (delayedStartRunnable != null) {
      return
    }

    val runnable = Runnable {
      executor.execute {
        synchronized(trackLock) {
          delayedStartRunnable = null
          val track = audioTrack
          if (track != null) {
            if (
              writeGeneration == generation.get() &&
              pendingPlaySamples > 0 &&
              track.playState != AudioTrack.PLAYSTATE_PLAYING
            ) {
              track.play()
              pendingPlaySamples = 0
            }
          }
        }
      }
    }

    delayedStartRunnable = runnable
    mainHandler.postDelayed(runnable, minBufferMs.toLong())
  }

  private fun cancelDelayedStartLocked() {
    delayedStartRunnable?.let { mainHandler.removeCallbacks(it) }
    delayedStartRunnable = null
  }
}
