package com.yuzik.mobile.dev

import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors

class TenVadModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  companion object {
    private const val DEFAULT_HOP_SIZE = 256
    private const val DEFAULT_THRESHOLD = 0.5f

    init {
      System.loadLibrary("ten_vad_jni")
    }
  }

  private val executor = Executors.newSingleThreadExecutor()
  private val lock = Any()
  private var handle: Long = 0
  private var hopSize: Int = DEFAULT_HOP_SIZE
  private var threshold: Float = DEFAULT_THRESHOLD
  private var pendingPcm = ByteArray(0)

  override fun getName(): String = "TenVad"

  @ReactMethod
  fun create(hopSize: Int, threshold: Double, promise: Promise) {
    if (hopSize != 160 && hopSize != 256) {
      promise.reject("E_TEN_VAD_HOP_SIZE", "TEN VAD hop size must be 160 or 256 samples.")
      return
    }
    if (threshold < 0.0 || threshold > 1.0) {
      promise.reject("E_TEN_VAD_THRESHOLD", "TEN VAD threshold must be between 0.0 and 1.0.")
      return
    }

    executor.execute {
      try {
        synchronized(lock) {
          destroyLocked()
          this.hopSize = hopSize
          this.threshold = threshold.toFloat()
          this.pendingPcm = ByteArray(0)
          this.handle = nativeCreate(hopSize, this.threshold)
        }
        promise.resolve(null)
      } catch (error: Exception) {
        promise.reject("E_TEN_VAD_CREATE", "Failed to create TEN VAD.", error)
      }
    }
  }

  @ReactMethod
  fun processPcm16(base64Pcm16: String, promise: Promise) {
    val incoming = try {
      Base64.decode(base64Pcm16, Base64.NO_WRAP)
    } catch (error: IllegalArgumentException) {
      promise.reject("E_TEN_VAD_BASE64", "PCM payload is not valid base64.", error)
      return
    }

    if (incoming.isEmpty()) {
      promise.resolve(Arguments.createArray())
      return
    }

    executor.execute {
      try {
        val results = Arguments.createArray()
        synchronized(lock) {
          ensureHandleLocked()
          val frameBytes = hopSize * 2
          val combined = pendingPcm + incoming
          val frameCount = combined.size / frameBytes

          for (frameIndex in 0 until frameCount) {
            val offset = frameIndex * frameBytes
            val frame = ShortArray(hopSize)
            ByteBuffer.wrap(combined, offset, frameBytes)
              .order(ByteOrder.LITTLE_ENDIAN)
              .asShortBuffer()
              .get(frame)

            val nativeResult = nativeProcessFrame(handle, frame)
            val result = Arguments.createMap()
            result.putDouble("probability", nativeResult[0].toDouble())
            result.putBoolean("isSpeech", nativeResult[1] >= 0.5f)
            results.pushMap(result)
          }

          val consumedBytes = frameCount * frameBytes
          pendingPcm = combined.copyOfRange(consumedBytes, combined.size)
        }
        promise.resolve(results)
      } catch (error: Exception) {
        promise.reject("E_TEN_VAD_PROCESS", "Failed to process PCM with TEN VAD.", error)
      }
    }
  }

  @ReactMethod
  fun reset(promise: Promise) {
    executor.execute {
      try {
        synchronized(lock) {
          destroyLocked()
          pendingPcm = ByteArray(0)
          handle = nativeCreate(hopSize, threshold)
        }
        promise.resolve(null)
      } catch (error: Exception) {
        promise.reject("E_TEN_VAD_RESET", "Failed to reset TEN VAD.", error)
      }
    }
  }

  @ReactMethod
  fun destroy(promise: Promise) {
    executor.execute {
      try {
        synchronized(lock) {
          destroyLocked()
          pendingPcm = ByteArray(0)
        }
        promise.resolve(null)
      } catch (error: Exception) {
        promise.reject("E_TEN_VAD_DESTROY", "Failed to destroy TEN VAD.", error)
      }
    }
  }

  @ReactMethod
  fun getVersion(promise: Promise) {
    try {
      promise.resolve(nativeGetVersion())
    } catch (error: Exception) {
      promise.reject("E_TEN_VAD_VERSION", "Failed to read TEN VAD version.", error)
    }
  }

  override fun invalidate() {
    executor.execute {
      synchronized(lock) {
        destroyLocked()
        executor.shutdown()
      }
    }
    super.invalidate()
  }

  private fun ensureHandleLocked() {
    if (handle == 0L) {
      handle = nativeCreate(hopSize, threshold)
    }
  }

  private fun destroyLocked() {
    if (handle != 0L) {
      nativeDestroy(handle)
      handle = 0
    }
  }

  private external fun nativeCreate(hopSize: Int, threshold: Float): Long
  private external fun nativeProcessFrame(handle: Long, frame: ShortArray): FloatArray
  private external fun nativeDestroy(handle: Long)
  private external fun nativeGetVersion(): String
}
