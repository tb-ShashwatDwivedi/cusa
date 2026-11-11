#!/usr/bin/env bash
# Build an RPM (RHEL/CentOS/SUSE) for the CUSA agent.
# Linux production packaging — closes the gap behind #8 / CYB-6109.
#
# Usage: ./build-rpm.sh <version> [arch]
#   ./build-rpm.sh 1.0.0 x86_64
#
# Produces: dist/cusa-agent-<version>-1.<arch>.rpm
# Requires: rpmbuild, a Node.js >= 20 runtime on the target.
set -euo pipefail

VERSION="${1:?usage: build-rpm.sh <version> [arch]}"
ARCH="${2:-x86_64}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # repo root (cusa/)
TOP="$(mktemp -d)"
OUT="${ROOT}/dist"
mkdir -p "${OUT}" "${TOP}"/{BUILD,RPMS,SOURCES,SPECS,BUILDROOT}

BR="${TOP}/BUILDROOT/cusa-agent-${VERSION}-1.${ARCH}"
install -d "${BR}/opt/cusa/agent" "${BR}/etc/cusa" "${BR}/lib/systemd/system"
cp -r "${ROOT}/agent/src" "${BR}/opt/cusa/agent/src"
cp -r "${ROOT}/agent/config" "${BR}/opt/cusa/agent/config"
cp "${ROOT}/agent/package.json" "${BR}/opt/cusa/agent/package.json"
cp "${ROOT}/agent/config/default.json" "${BR}/etc/cusa/config.json"
cp "${ROOT}/installer/linux/cusa-agent.service" "${BR}/lib/systemd/system/cusa-agent.service"

cat > "${TOP}/SPECS/cusa-agent.spec" <<EOF
Name:           cusa-agent
Version:        ${VERSION}
Release:        1
Summary:        CyberSIO Unified Security Agent
License:        Proprietary
BuildArch:      ${ARCH}
Requires:       nodejs >= 20.0.0

%description
Endpoint telemetry, FIM, inventory and active-response agent
speaking the Wazuh 4.x manager protocol.

%files
/opt/cusa/agent
/etc/cusa/config.json
/lib/systemd/system/cusa-agent.service

%post
if ! id cusa >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /sbin/nologin cusa || true
fi
mkdir -p /var/lib/cusa
chown -R cusa:cusa /var/lib/cusa /etc/cusa
systemctl daemon-reload || true
systemctl enable cusa-agent.service || true
systemctl restart cusa-agent.service || true

%preun
if [ \$1 -eq 0 ]; then
  systemctl stop cusa-agent.service || true
  systemctl disable cusa-agent.service || true
fi
EOF

rpmbuild --define "_topdir ${TOP}" --buildroot "${BR}" -bb "${TOP}/SPECS/cusa-agent.spec"
cp "${TOP}"/RPMS/*/*.rpm "${OUT}/"
rm -rf "${TOP}"
echo "Built RPM into ${OUT}"
