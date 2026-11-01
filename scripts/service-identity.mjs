/** Identity checks for the local launcher. HTTP 200 alone is not enough. */
export function centerReady(body) {
  return Boolean(body && body.ok === true && body.service === 'quota-center');
}

export function dingReady(body, buildId) {
  return Boolean(body && body.service === 'dingxiaosui' && body.quotaCenterEnabled === true && typeof buildId === 'string' && buildId.length > 0 && body.buildId === buildId);
}
