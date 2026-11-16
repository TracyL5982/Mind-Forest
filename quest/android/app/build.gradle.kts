import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The judging build (quest/tools/judge.sh): its own app beside the two on the user's headset, release-signed with the key
// in ~/.mind-palace/keys, joining its own service by itself, with the media inside the APK. What it needs is outside the
// repo: judging.properties (server=https://…, appKey=…, version=<n>) and keys/judge.jks with keys/judge.properties.
val mindPalace = File(System.getProperty("user.home"), ".mind-palace")
fun properties(file: File) = Properties().apply { if (file.exists()) file.inputStream().use { load(it) } }
val judging = properties(File(mindPalace, "judging.properties"))
val judgeKey = properties(File(mindPalace, "keys/judge.properties"))
val judgeMedia = file("build/judge-media")

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
        buildConfigField("String", "SERVER", "\"\"")
        buildConfigField("String", "APP_KEY", "\"\"")
        externalNativeBuild {
            cmake {
                arguments += listOf("-DANDROID_STL=c++_shared")
                // ./gradlew installDebug -PoceanScene=OFF builds the host with its test scene only.
                arguments += "-DOCEAN_SCENE=" + ((project.findProperty("oceanScene") as String?) ?: "ON")
            }
        }
    }

    signingConfigs {
        create("judge") {
            storeFile = File(mindPalace, "keys/judge.jks")
            storePassword = judgeKey.getProperty("storePassword")
            keyAlias = judgeKey.getProperty("keyAlias")
            keyPassword = judgeKey.getProperty("keyPassword")
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
        create("judge") {
            initWith(getByName("release"))
            applicationIdSuffix = ".judge"
            signingConfig = signingConfigs.getByName("judge")
            manifestPlaceholders["appLabel"] = "Mind Palace"
            externalNativeBuild { cmake { arguments += "-DCMAKE_BUILD_TYPE=Release" } }
            buildConfigField("String", "SERVER", "\"${judging.getProperty("server", "")}\"")
            buildConfigField("String", "APP_KEY", "\"${judging.getProperty("appKey", "")}\"")
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    buildFeatures {
        prefab = true
        buildConfig = true
    }

    // The keyword model the headset listens with (quest/tools/fetch-voice.sh puts it there).
    sourceSets["main"].assets.srcDir("../../vendor/sherpa-onnx/assets")
    // The judging build's media, which judge.sh lays out in build/judge-media/media with its index.txt.
    sourceSets["judge"].assets.srcDir(judgeMedia)
    // Stored, not deflated: a film is played from where it lies in the APK, and the rest is compressed already or small
    // (the app's own sounds, hand model and greeting fonts, with the fonts' notice).
    androidResources { noCompress += listOf("mp4", "jpg", "heic", "json", "wav", "bin", "ttf", "txt") }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

androidComponents {
    onVariants(selector().withBuildType("judge")) { variant ->
        val version = judging.getProperty("version", "1").toInt()
        variant.outputs.forEach {
            it.versionCode.set(version)
            it.versionName.set("$version (judging)")
        }
    }
}

// A judging build that would not join, could not be signed or carries no media stops here, saying what is missing.
gradle.taskGraph.whenReady {
    // (Not `preJudgeBuild`: the release build runs it too, since the two share one native build, and a machine
    // without the judging files must still be able to build the app for its own headset.)
    if (allTasks.none { it.project == project && it.name.contains("Judge") && it.name != "preJudgeBuild" }) return@whenReady
    val server = judging.getProperty("server", "")
    val key = judging.getProperty("appKey", "")
    val missing = listOfNotNull(
        "server=https://… in ${mindPalace}/judging.properties".takeUnless { server.matches(Regex("https://[A-Za-z0-9.-]+(:[0-9]+)?/?")) },
        "appKey=… (letters, digits, - and _) in ${mindPalace}/judging.properties".takeUnless { key.matches(Regex("[A-Za-z0-9_-]+")) },
        "the key ${mindPalace}/keys/judge.jks".takeUnless { File(mindPalace, "keys/judge.jks").exists() },
        "storePassword, keyAlias and keyPassword in ${mindPalace}/keys/judge.properties"
            .takeUnless { listOf("storePassword", "keyAlias", "keyPassword").all { !judgeKey.getProperty(it).isNullOrEmpty() } },
        "the media in $judgeMedia (quest/tools/judge.sh lays it out)".takeUnless { File(judgeMedia, "media/index.txt").exists() },
    )
    if (missing.isNotEmpty()) throw GradleException("The judging build needs:\n  " + missing.joinToString("\n  "))
}

dependencies {
    implementation("org.khronos.openxr:openxr_loader_for_android:1.1.58")
    // The agent service's WebSocket and HTTP (Net.kt).
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
