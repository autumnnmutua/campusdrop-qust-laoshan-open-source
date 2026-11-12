/* © 2026 专业团队 · CampusDrop v4.7.0 · WM-A372E4790D8B1C09-FFAB2177CB */
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "CampusDrop"
include(":app")
