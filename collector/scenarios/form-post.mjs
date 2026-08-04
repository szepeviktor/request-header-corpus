import { By, until } from 'selenium-webdriver';

export const scenario = {
  id: 'form-post',
  method: 'POST',
  path: '/capture/form',
};

export async function run(driver, baseUrl, token) {
  await driver.get(`${baseUrl}/scenario/form?token=${encodeURIComponent(token)}`);
  await driver.findElement(By.id('submit')).click();
  await driver.wait(until.elementLocated(By.id('captured')), 10_000);
}
