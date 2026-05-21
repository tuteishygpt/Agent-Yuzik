cmake_minimum_required(VERSION 3.18.1)

project(yuzik_ten_vad)

add_library(ten_vad_jni SHARED ten_vad_jni.cpp)

target_include_directories(
  ten_vad_jni
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

set(TEN_VAD_IMPORTED_LIBRARY
  ${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}/libten_vad.so
)

if(EXISTS ${TEN_VAD_IMPORTED_LIBRARY})
  add_library(ten_vad SHARED IMPORTED)
  set_target_properties(
    ten_vad
    PROPERTIES
      IMPORTED_LOCATION
        ${TEN_VAD_IMPORTED_LIBRARY}
  )
  target_compile_definitions(ten_vad_jni PRIVATE HAVE_TEN_VAD=1)
  target_link_libraries(ten_vad_jni ten_vad log)
else()
  target_compile_definitions(ten_vad_jni PRIVATE HAVE_TEN_VAD=0)
  target_link_libraries(ten_vad_jni log)
endif()
