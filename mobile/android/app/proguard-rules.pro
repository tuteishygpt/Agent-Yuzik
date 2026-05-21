# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# react-native-live-audio-stream
-keep class com.reagankm.liveaudiostream.** { *; }
-keep class com.rnliveaudiostream.** { *; }

# Expo modules
-keep class expo.modules.** { *; }

# Supabase / GoTrue
-keep class io.supabase.** { *; }

# OkHttp (used by React Native networking)
-dontwarn okhttp3.**
-keep class okhttp3.** { *; }

# Hermes
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }
