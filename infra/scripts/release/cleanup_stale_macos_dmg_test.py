import importlib.util
import unittest
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).with_name("cleanup-stale-macos-dmg.py")
SPEC = importlib.util.spec_from_file_location("cleanup_stale_macos_dmg", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class CleanupStaleMacosDmgTests(unittest.TestCase):
    def test_root_device_collapses_partition_suffixes(self) -> None:
        self.assertEqual(MODULE.root_device("/dev/disk4s1"), "/dev/disk4")
        self.assertEqual(MODULE.root_device("/dev/disk12"), "/dev/disk12")

    @mock.patch.object(MODULE, "time")
    @mock.patch.object(MODULE, "run_detach")
    def test_detach_device_retries_busy_root_device_with_force(self, run_detach: mock.Mock, time_mod: mock.Mock) -> None:
        run_detach.side_effect = [
            mock.Mock(returncode=16, stderr='hdiutil: couldn\'t eject "disk4" - Resource busy', stdout=""),
            mock.Mock(returncode=0, stderr="", stdout=""),
        ]

        ok = MODULE.detach_device("/dev/disk4s1", attempts=4)

        self.assertTrue(ok)
        self.assertEqual(run_detach.call_args_list[0], mock.call("/dev/disk4", force=False))
        self.assertEqual(run_detach.call_args_list[1], mock.call("/dev/disk4", force=True))
        time_mod.sleep.assert_called_once_with(1)

    @mock.patch.object(MODULE, "time")
    @mock.patch.object(MODULE, "run_detach")
    def test_detach_device_stops_on_non_retryable_exit(self, run_detach: mock.Mock, time_mod: mock.Mock) -> None:
        run_detach.return_value = mock.Mock(returncode=1, stderr="fatal", stdout="")

        ok = MODULE.detach_device("/dev/disk4s1", attempts=4)

        self.assertFalse(ok)
        run_detach.assert_called_once_with("/dev/disk4", force=False)
        time_mod.sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()
