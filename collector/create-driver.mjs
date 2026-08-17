import { Builder } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import edge from 'selenium-webdriver/edge.js';
import firefox from 'selenium-webdriver/firefox.js';
import safari from 'selenium-webdriver/safari.js';

function isHeadless() {
  return process.env.HEADLESS !== 'false';
}

export async function createDriver(browser) {
  let builder = new Builder().forBrowser(browser);

  if (browser === 'chrome') {
    const options = new chrome.Options().setChromeBinaryPath(
      process.env.CHROME_BINARY || 'google-chrome',
    );
    if (isHeadless()) options.addArguments('--headless=new');
    if (process.platform === 'linux') {
      options.addArguments('--no-sandbox', '--disable-dev-shm-usage');
    }
    if (process.platform === 'darwin') {
      options.addArguments(
        `--user-data-dir=${process.env.RUNNER_TEMP || '/tmp'}/chrome-profile`,
        '--remote-debugging-pipe',
      );
    }
    options.addArguments(
      '--disable-background-networking',
      '--disable-component-update',
      '--no-default-browser-check',
      '--no-first-run',
      '--window-size=1440,1200',
    );
    builder = builder.setChromeOptions(options);
    if (process.env.CHROMEDRIVER) {
      const service = new chrome.ServiceBuilder(process.env.CHROMEDRIVER);
      if (process.env.CHROMEDRIVER_VERBOSE === 'true') {
        service.enableVerboseLogging().enableChromeLogging();
        if (process.env.CHROMEDRIVER_LOG) {
          service.loggingTo(process.env.CHROMEDRIVER_LOG);
        }
      }
      builder = builder.setChromeService(service);
    }
  } else if (browser === 'MicrosoftEdge') {
    const options = new edge.Options().setEdgeChromiumBinaryPath(
      process.env.EDGE_BINARY || 'microsoft-edge',
    );
    if (isHeadless()) options.addArguments('--headless=new');
    if (process.platform === 'linux') {
      options.addArguments('--no-sandbox', '--disable-dev-shm-usage');
    }
    options.addArguments('--window-size=1440,1200');
    builder = builder.setEdgeOptions(options);
    if (process.env.EDGEDRIVER) {
      builder = builder.setEdgeService(new edge.ServiceBuilder(process.env.EDGEDRIVER));
    }
  } else if (browser === 'firefox') {
    const options = new firefox.Options().setBinary(process.env.FIREFOX_BINARY || 'firefox');
    if (isHeadless()) options.addArguments('-headless');
    if (process.env.FIREFOX_PROFILE) options.setProfile(process.env.FIREFOX_PROFILE);
    builder = builder.setFirefoxOptions(options);
    if (process.env.GECKODRIVER) {
      builder = builder.setFirefoxService(new firefox.ServiceBuilder(process.env.GECKODRIVER));
    }
  } else if (browser === 'safari') {
    builder = builder.setSafariOptions(new safari.Options());
  } else {
    throw new Error(`Unsupported browser: ${browser}`);
  }

  // No insecure-certificate capability or browser flag is set here by design.
  return builder.build();
}

export function browserNameForSelenium(browser) {
  return browser === 'edge' ? 'MicrosoftEdge' : browser;
}
