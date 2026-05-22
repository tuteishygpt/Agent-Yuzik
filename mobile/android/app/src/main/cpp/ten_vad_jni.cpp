#include <jni.h>

#include <android/log.h>
#include <cstdint>
#include <string>
#include <unistd.h>

#if HAVE_TEN_VAD
#include "ten_vad.h"
#endif

namespace {

constexpr const char *LOG_TAG = "YuzikTenVad";

void throwIllegalState(JNIEnv *env, const std::string &message) {
  jclass exceptionClass = env->FindClass("java/lang/IllegalStateException");
  if (exceptionClass != nullptr) {
    env->ThrowNew(exceptionClass, message.c_str());
  }
}

#if HAVE_TEN_VAD
ten_vad_handle_t fromHandle(jlong handle) {
  return reinterpret_cast<ten_vad_handle_t>(handle);
}
#endif

} // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_com_yuzik_mobile_dev_TenVadModule_nativeCreate(
    JNIEnv *env,
    jobject,
    jint hopSize,
    jfloat threshold) {
#if !HAVE_TEN_VAD
  throwIllegalState(env, "TEN VAD is not bundled for this Android ABI.");
  return 0;
#else
  ten_vad_handle_t handle = nullptr;
  const int result = ten_vad_create(&handle, static_cast<size_t>(hopSize), threshold);
  __android_log_print(
      ANDROID_LOG_INFO,
      LOG_TAG,
      "ten_vad_create result=%d handle=%p hopSize=%d threshold=%f",
      result,
      handle,
      hopSize,
      threshold);
  if (result != 0 || handle == nullptr) {
    throwIllegalState(env, "ten_vad_create failed.");
    return 0;
  }

  return reinterpret_cast<jlong>(handle);
#endif
}

extern "C" JNIEXPORT jfloatArray JNICALL
Java_com_yuzik_mobile_dev_TenVadModule_nativeProcessFrame(
    JNIEnv *env,
    jobject,
    jlong handle,
    jshortArray frame) {
#if !HAVE_TEN_VAD
  throwIllegalState(env, "TEN VAD is not bundled for this Android ABI.");
  return nullptr;
#else
  if (handle == 0) {
    throwIllegalState(env, "TEN VAD handle is not initialized.");
    return nullptr;
  }

  const jsize frameLength = env->GetArrayLength(frame);
  jshort *samples = env->GetShortArrayElements(frame, nullptr);
  if (samples == nullptr) {
    throwIllegalState(env, "Failed to read PCM frame.");
    return nullptr;
  }

  float probability = 0.0f;
  int flag = 0;
  const int result = ten_vad_process(
      fromHandle(handle),
      reinterpret_cast<int16_t *>(samples),
      static_cast<size_t>(frameLength),
      &probability,
      &flag);
  env->ReleaseShortArrayElements(frame, samples, JNI_ABORT);

  if (result != 0) {
    throwIllegalState(env, "ten_vad_process failed.");
    return nullptr;
  }

  jfloat output[2] = {probability, flag == 1 ? 1.0f : 0.0f};
  jfloatArray outputArray = env->NewFloatArray(2);
  if (outputArray == nullptr) {
    return nullptr;
  }
  env->SetFloatArrayRegion(outputArray, 0, 2, output);
  return outputArray;
#endif
}

extern "C" JNIEXPORT void JNICALL
Java_com_yuzik_mobile_dev_TenVadModule_nativeDestroy(
    JNIEnv *env,
    jobject,
    jlong handle) {
#if !HAVE_TEN_VAD
  return;
#else
  if (handle == 0) {
    return;
  }

  ten_vad_handle_t vadHandle = fromHandle(handle);
  const int result = ten_vad_destroy(&vadHandle);
  if (result != 0) {
    throwIllegalState(env, "ten_vad_destroy failed.");
  }
#endif
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_yuzik_mobile_dev_TenVadModule_nativeGetVersion(JNIEnv *env, jobject) {
#if !HAVE_TEN_VAD
  return env->NewStringUTF("unavailable");
#else
  const char *version = ten_vad_get_version();
  return env->NewStringUTF(version == nullptr ? "" : version);
#endif
}

extern "C" JNIEXPORT void JNICALL
Java_com_yuzik_mobile_dev_TenVadModule_nativeSetWorkingDirectory(
    JNIEnv *env,
    jobject,
    jstring path) {
  const char *pathChars = env->GetStringUTFChars(path, nullptr);
  if (pathChars == nullptr) {
    throwIllegalState(env, "Failed to read TEN VAD model directory.");
    return;
  }

  const int result = chdir(pathChars);
  __android_log_print(
      ANDROID_LOG_INFO,
      LOG_TAG,
      "chdir(%s) result=%d",
      pathChars,
      result);
  env->ReleaseStringUTFChars(path, pathChars);

  if (result != 0) {
    throwIllegalState(env, "Failed to set TEN VAD model directory.");
  }
}
