# tools.jar — GNU General Public License v2 with the Classpath Exception

`public/java/tools.jar` is **not** part of BroGram and is **not** covered by this
repository's MIT license. It is the OpenJDK 8 compiler (`com.sun.tools.javac.*`),
redistributed by Adoptium as part of the Eclipse Temurin 8 JDK, and it is
licensed under the **GNU General Public License, version 2, with the Classpath
Exception** (GPLv2+CE).

## Source

- Project: OpenJDK 8 (`jdk8u`), built and published as Eclipse Temurin.
- Exact build used: `jdk8u504-b01`.
- Archive: <https://github.com/adoptium/temurin8-binaries/releases/download/jdk8u504-b01/OpenJDK8U-jdk_x64_linux_hotspot_8u504b01.tar.gz>
  (sha256 `9c70e102f527ac674ac2fe9c7d47b9a04e2d19842ba5ab8e9b33f368bbadfaea`)
- Entry extracted: `jdk8u504-b01/lib/tools.jar`
  (18,361,919 bytes, sha256 `f2599fc78dcbfadefc1cb6b79e05d281e090217ac0139d50b792d72bf1130af4`)
- License text: the `LICENSE` file inside the same archive, and
  <https://openjdk.org/legal/gplv2+ce.html>.

`scripts/fetch-java-tools.mjs` performs that download and extraction and verifies
both the size and the sha256. The file itself is **not committed** to this
repository (see `.gitignore`); it is fetched at install time.

## The Classpath Exception, and why this is safe here

The Classpath Exception grants permission to link independent modules with the
covered library and to distribute the combination under terms of your choosing,
provided the covered library's own source remains available under GPLv2. BroGram
does not modify `tools.jar`, does not statically link it into any build artifact,
and does not derive from it: the browser loads it as an ordinary file and CheerpJ
invokes `com.sun.tools.javac.Main` as a separate program. BroGram's own source
stays MIT.

Anyone redistributing a BroGram deployment that serves this file is
redistributing an unmodified OpenJDK 8 binary and must keep this notice and the
source link above available. The corresponding source for `jdk8u504-b01` is
published at <https://github.com/adoptium/temurin8-binaries/releases/tag/jdk8u504-b01>
and at <https://github.com/openjdk/jdk8u>.
