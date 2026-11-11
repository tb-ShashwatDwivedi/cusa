/** Fixed CyberSIO/Wazuh 4.11 enrollment credentials — not user-editable.
 * NOTE: TLS policy (`insecure`/`caCert`) is deliberately NOT fixed here so the
 * secure-by-default config and operator CA settings are honored. CYB-5300. */
export const FIXED_ENROLLMENT = {
  password: 'wazuh-wui',
  apiUser: 'wazuh-wui',
  apiPassword: 'wazuh-wui',
  apiPort: 55000,
};

/**
 * Always apply fixed API/authd credentials (dev, service, MSI).
 * @param {object} config
 */
export function applyFixedEnrollment(config) {
  const prev = config.wazuh?.enrollment || {};
  config.wazuh = config.wazuh || {};
  config.wazuh.enrollment = {
    ...prev,
    password: FIXED_ENROLLMENT.password,
    apiUser: FIXED_ENROLLMENT.apiUser,
    apiPassword: FIXED_ENROLLMENT.apiPassword,
    apiPort: prev.apiPort || FIXED_ENROLLMENT.apiPort,
    insecure: prev.insecure !== false,
    groups: prev.groups?.length ? prev.groups : ['default'],
  };
  return config;
}

/** Strip secrets from API/GUI payloads. */
export function redactEnrollment(enrollment = {}) {
  const { password, apiPassword, ...rest } = enrollment;
  return {
    ...rest,
    password: password ? true : false,
    apiPassword: apiPassword ? true : false,
  };
}
