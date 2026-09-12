require "minitest/autorun"
require "tmpdir"
require "fileutils"

# Load the actual lanes with upload/build actions stubbed: no signing or network.
class LaneHarness
  attr_reader :uploads
  def initialize(file)
    @lanes = {}
    @uploads = []
    instance_eval(File.read(file), file)
  end
  def fastlane_version(*) end
  def default_platform(*) end
  def desc(*) end
  def platform(*)
    yield
  end
  def lane(name, &block)
    @lanes[name] = block
  end
  alias private_lane lane
  def run(name)
    @lanes.fetch(name).call
  end
  def upload_to_app_store(**options)
    @uploads << options
  end
  def upload_to_play_store(**options)
    @uploads << options
  end
end

class MobileFastlaneTest < Minitest::Test
  def setup
    @root = Dir.mktmpdir("aura-mobile-lanes")
    @old_env = ENV.to_h
  end
  def teardown
    ENV.replace(@old_env)
    FileUtils.remove_entry(@root)
  end
  def harness(platform)
    source = File.expand_path("../../#{platform}/fastlane/Fastfile", __dir__)
    @lane_dir = File.join(@root, platform, "fastlane")
    FileUtils.mkdir_p(@lane_dir)
    target = File.join(@lane_dir, "Fastfile")
    FileUtils.cp(source, target)
    h = LaneHarness.new(target)
    h.define_singleton_method(:ensure_app_store_release_requirements!) {}
    h.define_singleton_method(:ensure_play_store_release_requirements!) {}
    h.define_singleton_method(:setup_ci_signing_environment!) {}
    h.define_singleton_method(:app_store_api_key) { "test-key" }
    h.define_singleton_method(:sync_signing!) { |**_| }
    h.define_singleton_method(:is_ci) { true }
    h.define_singleton_method(:build_store_archive) {}
    h.define_singleton_method(:build_release_bundle) { "/tmp/test.aab" }
    h.define_singleton_method(:play_json_key_data) { "{}" }
    h
  end
  def asset(path)
    full = File.join(@lane_dir, path)
    FileUtils.mkdir_p(File.dirname(full))
    File.write(full, "test asset")
    full
  end
  def test_ios_metadata_and_screenshots_resolve_from_any_working_directory
    h = harness("ios")
    asset("metadata/en-US/description.txt")
    asset("screenshots/en-US/phone.png")
    [@root, @lane_dir].each do |cwd|
      Dir.chdir(cwd) { h.run(:release) }
      args = h.uploads.last
      refute args[:skip_metadata]
      refute args[:skip_screenshots]
      assert_equal File.join(@lane_dir, "metadata"), args[:metadata_path]
      assert_equal File.join(@lane_dir, "screenshots"), args[:screenshots_path]
      refute args[:automatic_release]
    end
  end
  def test_readme_only_does_not_count_as_store_metadata
    h = harness("ios")
    asset("metadata/README.md")
    h.run(:release)
    assert h.uploads.last[:skip_metadata]
    assert h.uploads.last[:skip_screenshots]
  end
  def test_android_metadata_resolves_inside_fastlane_directory
    h = harness("android")
    asset("metadata/android/en-US/full_description.txt")
    ENV.delete("ANDROID_PLAY_RELEASE_STATUS")
    Dir.chdir(@lane_dir) { h.run(:beta) }
    args = h.uploads.last
    refute args[:skip_upload_metadata]
    assert_equal File.join(@lane_dir, "metadata/android"), args[:metadata_path]
    assert_equal "draft", args[:release_status]
    assert_equal "internal", args[:track]
  end
  def test_android_beta_honors_explicit_release_status_and_track
    h = harness("android")
    ENV["ANDROID_PLAY_RELEASE_STATUS"] = "completed"
    ENV["ANDROID_PLAY_TRACK"] = "beta"
    h.run(:beta)
    assert_equal "completed", h.uploads.last[:release_status]
    assert_equal "beta", h.uploads.last[:track]
    assert h.uploads.last[:skip_upload_metadata]
  end
end
