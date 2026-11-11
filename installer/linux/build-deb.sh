#!/usr/bin/env bash
# Build a Debian/Ubuntu .deb for the CUSA agent.
# Linux production packaging — closes the gap behind #8 / CYB-6109 (Linux log
# collection code existed but had no shipped install path).
#
# Usage: ./build-deb.sh <version> [arch]
#   ./build-deb.sh 1.0.0 amd64
#
# Produces: dist/cusa-agent_<version>_<arch>.deb
# Requires: dpkg-deb, a Node.js >= 20 runtime available on the target (or bundle one).
set -euo pipefail

VERSION="${1:?usage: build-deb.sh <version> [arch]}"
ARCH="${2:-amd64}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # repo root (cusa/)
STAGE="$(mktemp -d)"
OUT="${ROOT}/dist"
mkdir -p "${OUT}"

echo "Staging CUSA agent ${VERSION} (${ARCH}) in ${STAGE}"

# Layout: agent code under /opt/cusa/agent, config under /etc/cusa, unit under /lib/systemd/system
install -d "${STAGE}/opt/cusa/agent"
cp -r "${ROOT}/agent/src" "${STAGE}/opt/cusa/agent/src"
cp -r "${ROOT}/agent/config" "${STAGE}/opt/cusa/agent/config"
cp "${ROOT}/agent/package.json" "${STAGE}/opt/cusa/agent/package.json"

install -d "${STAGE}/etc/cusa"
# Ship default.json as the seed config; operators edit /etc/cusa/config.json.
cp "${ROOT}/agent/config/default.json" "${STAGE}/etc/cusa/config.json"

install -d "${STAGE}/lib/systemd/system"
cp "${ROOT}/installer/linux/cusa-agent.service" "${STAGE}/lib/systemd/system/cusa-agent.service"

# Control metadata
install -d "${STAGE}/DEBIAN"
cat > "${STAGE}/DEBIAN/control" <<EOF
Package: cusa-agent
Version: ${VERSION}
Section: admin
Priority: optional
Architecture: ${ARCH}
Depends: nodejs (>= 20.0.0)
Maintainer: CyberSIO <support@cybersio.example>
Description: CyberSIO Unified Security Agent
 Endpoint telemetry, FIM, inventory and active-response agent
 speaking the Wazuh 4.x manager protocol.
EOF

# Maintainer scripts: create service user, enable + start on install; stop on remove.
cat > "${STAGE}/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
if ! id cusa >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin cusa || true
fi
mkdir -p /var/lib/cusa
chown -R cusa:cusa /var/lib/cusa /etc/cusa
systemctl daemon-reload || true
systemctl enable cusa-agent.service || true
systemctl restart cusa-agent.service || true
EOF

cat > "${STAGE}/DEBIAN/prerm" <<'EOF'
#!/bin/sh
set -e
systemctl stop cusa-agent.service || true
systemctl disable cusa-agent.service || true
EOF

chmod 0755 "${STAGE}/DEBIAN/postinst" "${STAGE}/DEBIAN/prerm"

DEB="${OUT}/cusa-agent_${VERSION}_${ARCH}.deb"
dpkg-deb --build --root-owner-group "${STAGE}" "${DEB}"
rm -rf "${STAGE}"
echo "Built ${DEB}"
