export const scenario = {
  id: 'navigation-get',
  method: 'GET',
  path: '/capture/navigation',
};

export async function run(driver, baseUrl, token) {
  await driver.get(`${baseUrl}${scenario.path}?token=${encodeURIComponent(token)}`);
}
