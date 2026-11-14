#!/usr/bin/env node

/**
 * ios-build.mjs — Stages the default-profile build as the iOS app's web content.
 *
 * Usage:
 *   node ios-build.mjs [profile-name]   → ios-www/index.html, then `npx cap sync ios`
 *
 * Capacitor bundles a webDir with an index.html, so this copies
 * dist/RadioGridXL.html there. No PWA sidecars: the app runs from
 * capacitor://localhost, where the service worker, help link and feedback
 * card already switch themselves off (they need an http(s) origin).
 */

import { copyFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const profileName = process.argv[2] || 'default'
const webDir = join(__dirname, 'ios-www')

execFileSync(process.execPath, [join(__dirname, 'build-profile.mjs'), profileName], { stdio: 'inherit' })
await mkdir(webDir, { recursive: true })
await copyFile(join(__dirname, 'dist', 'RadioGridXL.html'), join(webDir, 'index.html'))
console.log(`ios-www/index.html staged from the ${profileName} profile`)
