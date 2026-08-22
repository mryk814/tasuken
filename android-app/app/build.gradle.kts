import java.util.Properties

val taskenReleaseSigningProperties = Properties()
val taskenReleaseSigningPropertiesFile = rootProject.file("keystore.properties")
if (taskenReleaseSigningPropertiesFile.isFile) {
    taskenReleaseSigningPropertiesFile.inputStream().use(taskenReleaseSigningProperties::load)
}

fun taskenReleaseSigningValue(propertyKey: String, environmentKey: String): String? =
    taskenReleaseSigningProperties.getProperty(propertyKey)?.trim()?.takeIf { it.isNotEmpty() }
        ?: providers.gradleProperty(environmentKey).orNull?.trim()?.takeIf { it.isNotEmpty() }
        ?: providers.environmentVariable(environmentKey).orNull?.trim()?.takeIf { it.isNotEmpty() }

val taskenReleaseStoreFilePath = taskenReleaseSigningValue("storeFile", "TASKEN_ANDROID_KEYSTORE")
val taskenReleaseStorePassword = taskenReleaseSigningValue("storePassword", "TASKEN_ANDROID_KEYSTORE_PASSWORD")
val taskenReleaseKeyAlias = taskenReleaseSigningValue("keyAlias", "TASKEN_ANDROID_KEY_ALIAS")
val taskenReleaseKeyPassword = taskenReleaseSigningValue("keyPassword", "TASKEN_ANDROID_KEY_PASSWORD")
val taskenMissingReleaseSigningValues = buildList {
    if (taskenReleaseStoreFilePath == null) add("TASKEN_ANDROID_KEYSTORE / storeFile")
    if (taskenReleaseStorePassword == null) add("TASKEN_ANDROID_KEYSTORE_PASSWORD / storePassword")
    if (taskenReleaseKeyAlias == null) add("TASKEN_ANDROID_KEY_ALIAS / keyAlias")
    if (taskenReleaseKeyPassword == null) add("TASKEN_ANDROID_KEY_PASSWORD / keyPassword")
}
val taskenReleaseSigningConfigured = taskenMissingReleaseSigningValues.isEmpty()
val requireTaskenReleaseSigning: () -> Unit = {
    if (!taskenReleaseSigningConfigured) {
        throw GradleException(
            "Release signing is not configured. Missing: ${taskenMissingReleaseSigningValues.joinToString()}. " +
                "Use environment variables, Gradle properties, or android-app/keystore.properties.",
        )
    }
    val keystore = rootProject.file(requireNotNull(taskenReleaseStoreFilePath))
    if (!keystore.isFile) {
        throw GradleException("Release keystore does not exist: ${keystore.absolutePath}")
    }
}

plugins {
    id("com.android.application")
    id("com.google.devtools.ksp")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "jp.personal.tasken.companion"
    compileSdk = 36

    defaultConfig {
        applicationId = "jp.personal.tasken.companion"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (taskenReleaseSigningConfigured) {
            create("release") {
                storeFile = rootProject.file(requireNotNull(taskenReleaseStoreFilePath))
                storePassword = requireNotNull(taskenReleaseStorePassword)
                keyAlias = requireNotNull(taskenReleaseKeyAlias)
                keyPassword = requireNotNull(taskenReleaseKeyPassword)
            }
        }
    }

    buildTypes {
        getByName("release") {
            if (taskenReleaseSigningConfigured) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets.getByName("test").resources.directories.apply {
        clear()
        add(rootProject.file("../contracts/mobile/v1").absolutePath)
        add(rootProject.file("../design-standard").absolutePath)
    }
    sourceSets.getByName("androidTest").assets.srcDir(file("schemas"))
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.06.01")
    val roomVersion = "2.8.4"
    val workVersion = "2.11.2"

    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material3.adaptive:adaptive:1.2.0")
    implementation("androidx.compose.material3.adaptive:adaptive-layout:1.2.0")
    implementation("androidx.compose.material3.adaptive:adaptive-navigation:1.2.0")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("androidx.room:room-runtime:$roomVersion")
    implementation("androidx.room:room-ktx:$roomVersion")
    implementation("androidx.work:work-runtime-ktx:$workVersion")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")

    ksp("androidx.room:room-compiler:$roomVersion")

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.room:room-testing:$roomVersion")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

ksp {
    arg("room.schemaLocation", file("schemas").absolutePath)
}

val taskenReleasePackagingTasks = setOf(
    "assemblerelease",
    "bundlerelease",
    "installrelease",
    "packagerelease",
    "publishreleasebundle",
    "signreleasebundle",
)
if (gradle.startParameter.taskNames.any {
        it.substringAfterLast(':').lowercase() in taskenReleasePackagingTasks
    }
) {
    requireTaskenReleaseSigning()
}

tasks.register("verifyReleaseSigning") {
    group = "verification"
    description = "Fails unless Tasken Android release signing material is complete and readable."
    doLast { requireTaskenReleaseSigning() }
}
