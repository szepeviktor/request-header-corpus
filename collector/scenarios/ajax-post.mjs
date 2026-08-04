export const scenario = {
  id: 'ajax-post',
  method: 'POST',
  path: '/capture/ajax',
};

export async function run(driver, baseUrl, token) {
  await driver.get(`${baseUrl}/scenario/ajax?token=${encodeURIComponent(token)}`);
  const result = await driver.executeAsyncScript(
    `const done = arguments[arguments.length - 1];
     fetch(${JSON.stringify(`${baseUrl}${scenario.path}`)} + '?token=' + encodeURIComponent(arguments[0]), {
       method: 'POST',
       headers: {'Content-Type': 'application/json'},
       body: JSON.stringify({payload: 'header-corpus'})
     }).then(async response => done({
       ok: response.ok,
       status: response.status,
       body: await response.text()
     })).catch(error => done({ok: false, error: String(error)}));`,
    token,
  );
  if (!result?.ok) throw new Error(`AJAX capture failed: ${JSON.stringify(result)}`);
}
