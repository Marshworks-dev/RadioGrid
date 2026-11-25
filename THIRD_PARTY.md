# Third-party software

The web app (`RadioGridXL.html`) includes no third-party code. The store apps
wrap it and bundle the components below. Full license texts and notices are on
the licences page, `licences/index.html`, published at
radio.marshworks.dev/licences.

## Android app (`twa/`)

Google's Android Browser Helper and the libraries it pulls in, all under the
Apache License, Version 2.0. The list is the release runtime classpath:
`./gradlew :app:dependencies --configuration releaseRuntimeClasspath` in `twa/`.

- `androidx.activity:activity:1.9.0`
- `androidx.annotation:annotation-experimental:1.4.1`
- `androidx.annotation:annotation-jvm:1.9.1`
- `androidx.annotation:annotation:1.9.1`
- `androidx.appcompat:appcompat-resources:1.7.0`
- `androidx.appcompat:appcompat:1.7.0`
- `androidx.arch.core:core-common:2.2.0`
- `androidx.arch.core:core-runtime:2.2.0`
- `androidx.browser:browser:1.10.0`
- `androidx.collection:collection-jvm:1.4.2`
- `androidx.collection:collection:1.4.2`
- `androidx.concurrent:concurrent-futures:1.1.0`
- `androidx.core:core-ktx:1.17.0`
- `androidx.core:core-viewtree:1.0.0`
- `androidx.core:core:1.17.0`
- `androidx.cursoradapter:cursoradapter:1.0.0`
- `androidx.customview:customview:1.0.0`
- `androidx.drawerlayout:drawerlayout:1.0.0`
- `androidx.emoji2:emoji2-views-helper:1.3.0`
- `androidx.emoji2:emoji2:1.3.0`
- `androidx.fragment:fragment:1.5.4`
- `androidx.interpolator:interpolator:1.0.0`
- `androidx.lifecycle:lifecycle-common:2.6.2`
- `androidx.lifecycle:lifecycle-livedata-core:2.6.2`
- `androidx.lifecycle:lifecycle-livedata:2.6.2`
- `androidx.lifecycle:lifecycle-process:2.6.2`
- `androidx.lifecycle:lifecycle-runtime:2.6.2`
- `androidx.lifecycle:lifecycle-viewmodel-savedstate:2.6.2`
- `androidx.lifecycle:lifecycle-viewmodel:2.6.2`
- `androidx.loader:loader:1.0.0`
- `androidx.profileinstaller:profileinstaller:1.3.1`
- `androidx.resourceinspection:resourceinspection-annotation:1.0.1`
- `androidx.savedstate:savedstate:1.2.1`
- `androidx.startup:startup-runtime:1.1.1`
- `androidx.tracing:tracing:1.2.0`
- `androidx.vectordrawable:vectordrawable-animated:1.1.0`
- `androidx.vectordrawable:vectordrawable:1.1.0`
- `androidx.versionedparcelable:versionedparcelable:1.1.1`
- `androidx.viewpager:viewpager:1.0.0`
- `com.google.androidbrowserhelper:androidbrowserhelper:2.7.4`
- `com.google.guava:failureaccess:1.0.3`
- `com.google.guava:guava:33.4.8-android`
- `com.google.guava:listenablefuture:9999.0-empty-to-avoid-conflict-with-guava`
- `com.google.j2objc:j2objc-annotations:3.0.0`
- `org.jetbrains:annotations:23.0.0`
- `org.jetbrains.kotlin:kotlin-bom:1.8.22`
- `org.jetbrains.kotlin:kotlin-stdlib:2.1.20`
- `org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1`
- `org.jetbrains.kotlinx:kotlinx-coroutines-bom:1.8.1`
- `org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm:1.8.1`
- `org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.1`
- `org.jspecify:jspecify:1.0.0`

The launcher code and some resource files in `twa/app/src/` come from Google's
Bubblewrap project template, Copyright 2019–2021 Google Inc., under the Apache
License, Version 2.0. Their headers say so file by file.

## iOS app (`ios/`)

- `capacitor-swift-pm` (Capacitor), MIT License, © 2017-present Drifty Co.
- Its Cordova bridge includes Apache Cordova code, Apache License, Version 2.0,
  with Apache Cordova's NOTICE.

## Development tools

Packages in `package.json`'s `devDependencies` build and test the app and are
not shipped in it. They keep their own licenses.
