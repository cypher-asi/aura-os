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

    @mock.patch.object(MODULE, "diskutil_force_eject")
    @mock.patch.object(MODULE, "diskutil_force_unmount")
    @mock.patch.object(MODULE, "log_open_files")
    @mock.patch.object(MODULE, "disable_spotlight")
    @mock.patch.object(MODULE, "time")
    @mock.patch.object(MODULE, "run_detach")
    def test_detach_device_disables_spotlight_for_each_mount_point(
        self,
        run_detach: mock.Mock,
        time_mod: mock.Mock,
        disable_spotlight: mock.Mock,
        log_open_files: mock.Mock,
        diskutil_unmount: mock.Mock,
        diskutil_eject: mock.Mock,
    ) -> None:
        run_detach.return_value = mock.Mock(returncode=0, stderr="", stdout="")

        ok = MODULE.detach_device(
            "/dev/disk4s1",
            mount_points=("/Volumes/Aura", "/Volumes/Aura 1"),
        )

        self.assertTrue(ok)
        self.assertEqual(disable_spotlight.call_count, 2)
        disable_spotlight.assert_any_call("/Volumes/Aura")
        disable_spotlight.assert_any_call("/Volumes/Aura 1")
        diskutil_unmount.assert_not_called()
        diskutil_eject.assert_not_called()
        log_open_files.assert_not_called()
        time_mod.sleep.assert_not_called()

    @mock.patch.object(MODULE, "diskutil_force_eject")
    @mock.patch.object(MODULE, "diskutil_force_unmount")
    @mock.patch.object(MODULE, "log_open_files")
    @mock.patch.object(MODULE, "disable_spotlight")
    @mock.patch.object(MODULE, "time")
    @mock.patch.object(MODULE, "run_detach")
    def test_detach_device_force_unmounts_mount_points_between_busy_attempts(
        self,
        run_detach: mock.Mock,
        time_mod: mock.Mock,
        disable_spotlight: mock.Mock,
        log_open_files: mock.Mock,
        diskutil_unmount: mock.Mock,
        diskutil_eject: mock.Mock,
    ) -> None:
        run_detach.side_effect = [
            mock.Mock(returncode=16, stderr="busy", stdout=""),
            mock.Mock(returncode=0, stderr="", stdout=""),
        ]

        ok = MODULE.detach_device(
            "/dev/disk4s1",
            mount_points=("/Volumes/Aura",),
            attempts=4,
        )

        self.assertTrue(ok)
        diskutil_unmount.assert_called_once_with("/Volumes/Aura")
        log_open_files.assert_called_once_with("/Volumes/Aura")
        diskutil_eject.assert_not_called()
        time_mod.sleep.assert_called_once_with(1)

    @mock.patch.object(MODULE, "diskutil_force_eject")
    @mock.patch.object(MODULE, "diskutil_force_unmount")
    @mock.patch.object(MODULE, "log_open_files")
    @mock.patch.object(MODULE, "disable_spotlight")
    @mock.patch.object(MODULE, "time")
    @mock.patch.object(MODULE, "run_detach")
    def test_detach_device_falls_back_to_diskutil_eject_after_exhausting_retries(
        self,
        run_detach: mock.Mock,
        time_mod: mock.Mock,
        disable_spotlight: mock.Mock,
        log_open_files: mock.Mock,
        diskutil_unmount: mock.Mock,
        diskutil_eject: mock.Mock,
    ) -> None:
        run_detach.return_value = mock.Mock(returncode=16, stderr="busy", stdout="")
        diskutil_eject.return_value = True

        ok = MODULE.detach_device(
            "/dev/disk4s1",
            mount_points=("/Volumes/Aura",),
            attempts=2,
        )

        self.assertTrue(ok)
        self.assertEqual(run_detach.call_count, 2)
        diskutil_eject.assert_called_once_with("/dev/disk4")
        self.assertEqual(diskutil_unmount.call_count, 2)
        time_mod.sleep.assert_called_once_with(1)

    @mock.patch.object(MODULE, "diskutil_force_eject")
    @mock.patch.object(MODULE, "diskutil_force_unmount")
    @mock.patch.object(MODULE, "log_open_files")
    @mock.patch.object(MODULE, "disable_spotlight")
    @mock.patch.object(MODULE, "time")
    @mock.patch.object(MODULE, "run_detach")
    def test_detach_device_returns_false_when_all_fallbacks_fail(
        self,
        run_detach: mock.Mock,
        time_mod: mock.Mock,
        disable_spotlight: mock.Mock,
        log_open_files: mock.Mock,
        diskutil_unmount: mock.Mock,
        diskutil_eject: mock.Mock,
    ) -> None:
        run_detach.return_value = mock.Mock(returncode=16, stderr="busy", stdout="")
        diskutil_eject.return_value = False

        ok = MODULE.detach_device(
            "/dev/disk4s1",
            mount_points=("/Volumes/Aura",),
            attempts=2,
        )

        self.assertFalse(ok)
        diskutil_eject.assert_called_once_with("/dev/disk4")

    @mock.patch.object(MODULE, "run_command")
    def test_disable_spotlight_invokes_mdutil_off(self, run_command: mock.Mock) -> None:
        MODULE.disable_spotlight("/Volumes/Aura")

        run_command.assert_called_once_with(["mdutil", "-i", "off", "/Volumes/Aura"])

    @mock.patch.object(MODULE, "run_command")
    def test_disable_spotlight_skips_empty_mount_point(self, run_command: mock.Mock) -> None:
        MODULE.disable_spotlight("")

        run_command.assert_not_called()

    @mock.patch.object(MODULE, "run_command")
    def test_diskutil_force_unmount_returns_true_on_success(self, run_command: mock.Mock) -> None:
        run_command.return_value = mock.Mock(returncode=0, stderr="", stdout="")

        ok = MODULE.diskutil_force_unmount("/Volumes/Aura")

        self.assertTrue(ok)
        run_command.assert_called_once_with(["diskutil", "unmount", "force", "/Volumes/Aura"])

    @mock.patch.object(MODULE, "run_command")
    def test_diskutil_force_eject_returns_true_on_success(self, run_command: mock.Mock) -> None:
        run_command.return_value = mock.Mock(returncode=0, stderr="", stdout="")

        ok = MODULE.diskutil_force_eject("/dev/disk4")

        self.assertTrue(ok)
        run_command.assert_called_once_with(["diskutil", "eject", "force", "/dev/disk4"])


if __name__ == "__main__":
    unittest.main()
