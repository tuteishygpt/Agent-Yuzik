package com.yuzik.mobile.dev

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
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
  private val executor = Executors.newSingleThreadExecutor()
  private val generation = AtomicInteger(0)
  private val trackLock = Any()
  private var audioTrack: AudioTrack? = null
  private var currentSampleRate: Int? = null

  override fun getName(): String = "NativePcmPlayer"

  @ReactMethod
  fun pushFloat32Pcm(base64Pcm: String, sampleRate: Int, promise: Promise) {
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

    val writeGeneration = generation.get()
    executor.execute {
      try {
        if (writeGeneration != generation.get()) {
          promise.resolve(null)
          return@execute
        }

        val track = ensureTrack(sampleRate)
        if (track.playState != AudioTrack.PLAYSTATE_PLAYING) {
          track.play()
        }
        track.write(floats, 0, floats.size, AudioTrack.WRITE_BLOCKING)
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

      val minBufferSize = AudioTrack.getMinBufferSize(
        sampleRate,
        AudioFormat.CHANNEL_OUT_MONO,
        AudioFormat.ENCODING_PCM_FLOAT
      )
      val bufferSize = if (minBufferSize > 0) {
        maxOf(minBufferSize, 4096)
      } else {
        sampleRate * 4 / 10
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
    }
  }
}
