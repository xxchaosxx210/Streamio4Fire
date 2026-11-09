import importlib.util
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('prepare',Path(__file__).with_name('prepare-tv-assets.py'))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class AssetFingerprintTest(unittest.TestCase):
    def test_update_changes_local_url_and_preserves_external_urls(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'vega-tv.js').write_text('navigation')
            css=root/'main.css';css.write_text('old')
            index=root/'index.html'
            index.write_text('<head><link href="main.css?theme=tv"><script src="https://example.org/external.js"></script></head>')
            module.prepare(index);first=index.read_text()
            self.assertIn('main.css?theme=tv&s4f-build=',first)
            self.assertIn('src="/tv.js?s4f-build=',first)
            self.assertIn('src="https://example.org/external.js"',first)
            module.prepare(index);self.assertEqual(first,index.read_text())
            css.write_text('new');module.prepare(index)
            self.assertNotEqual(first,index.read_text())
            self.assertEqual(index.read_text().count('src="/tv.js'),1)

if __name__=='__main__':
    unittest.main()
