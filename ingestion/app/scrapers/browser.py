"""
Lightweight, headless Chrome wrapper for one-off page fetches.
Keeps Selenium usage boxed into a single place.
"""
from contextlib import contextmanager
from selenium.webdriver import Chrome, ChromeOptions
from selenium.webdriver.chrome.service import Service as ChromeService
from webdriver_manager.chrome import ChromeDriverManager

DEFAULT_ARGS = (
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--disable-gpu",  "--blink-settings=imagesEnabled=false"
)

@contextmanager
def make_driver(*extra_args: str):
    opts = ChromeOptions()
    for arg in (*DEFAULT_ARGS, *extra_args):
        opts.add_argument(arg)

    driver = Chrome(service=ChromeService(ChromeDriverManager().install()), options=opts)
    try:
        yield driver
    finally:
        driver.quit()
