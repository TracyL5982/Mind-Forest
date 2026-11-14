plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.kaifengwu.mindpalace"
    compileSdk = 34
    ndkVersion = "27.2.12479018"

    defaultConfig {
        // The same identifier as the visionOS ocean target.
        applicationId = "com.kaifengwu.mindpalace.ocean"
        // -PappSuffix=.agents installs a second copy beside the first, with its own files and media
        // (a build signed on another machine cannot be installed over the first without removing it).
        val suffix = (project.findProperty("appSuffix") as String?) ?: ""
        applicationIdSuffix = suffix
        manifestPlaceholders["appLabel"] = if (suffix.isEmpty()) "Mind Palace Ocean" else "Mind Palace Ocean ($suffix)".replace("(.", "(")
        minSdk = 29
        targetSdk = 34
        versionCode = 1
        versionName = "0.1"
        ndk { abiFilters += "arm64-v8a" }
        externalNativeBuild {
            cmake {
                arguments += listOf("-DANDROID_STL=c++_shared")
                // ./gradlew installDebug -PoceanScene=OFF builds the host with its test scene only.
                arguments += "-DOCEAN_SCENE=" + ((project.findProperty("oceanScene") as String?) ?: "ON")
            }
        }
    }

    buildTypes {
        // Optimized even in debug, as the visionOS project is: hundreds of
        // cards and curves are updated every frame, too slow unoptimized.
        debug {
            externalNativeBuild { cmake { arguments += "-DCMAKE_BUILD_TYPE=RelWithDebInfo" } }
        }
        // For performance runs: not debuggable (the manifest still lets the
        // shell profile it), signed with the debug key so it installs over adb.
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
            externalNativeBuild { cmake { arguments += "-DCMAKE_BUILD_TYPE=Release" } }
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    buildFeatures { prefab = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("org.khronos.openxr:openxr_loader_for_android:1.1.58")
    // The agent service's WebSocket and HTTP (Net.kt).
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
