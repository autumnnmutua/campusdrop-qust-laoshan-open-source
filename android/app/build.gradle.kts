/* © 2026 专业团队 · CampusDrop v4.5.0 */
import java.net.URI

plugins {
    id("com.android.application")
}

// The site the app opens. Override without editing this file:
//   ./gradlew assembleRelease -PsiteUrl=https://your-domain.example
val siteUrl: String = (project.findProperty("siteUrl") as String?)
    ?: "https://campusdrop-qust-laoshan-production.esthertreu3724.workers.dev"
val siteHost: String = URI(siteUrl).host
    ?: throw GradleException("siteUrl must be a full https:// address")
require(siteUrl.startsWith("https://")) { "siteUrl must start with https://" }

// Release signing comes from locally managed environment variables; without them only the debug
// APK is signed, which installs fine for testing.
val keystorePath: String? = System.getenv("ANDROID_KEYSTORE_PATH")

android {
    namespace = "cn.campusdrop.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "cn.campusdrop.app"
        minSdk = 24
        targetSdk = 35
        versionCode = 450
        versionName = "4.5.0"
        resValue("string", "site_url", siteUrl.trimEnd('/') + "/")
        manifestPlaceholders["siteHost"] = siteHost
    }

    buildFeatures {
        buildConfig = true
        resValues = true
    }

    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (keystorePath != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
