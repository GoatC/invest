#!/usr/bin/env ruby
# Writes ios/LongView.xcodeproj from the files in ios/Shell, with the xcodeproj gem (the library
# CocoaPods uses), so the project file is never typed by hand. Run it again after adding or
# removing a Swift file: `gem install xcodeproj && ruby ios/project.rb`. Hugo does not need to run
# it: the project it writes is in git.
require 'fileutils'
require 'xcodeproj'

here = __dir__
path = File.join(here, 'LongView.xcodeproj')
FileUtils.rm_rf(path)
# The project format of Xcode 14 and later; marked as checked by a current Xcode, so opening it
# offers no "update to recommended settings" (which would rewrite a file git tracks).
project = Xcodeproj::Project.new(path, false, 56)
project.root_object.attributes['LastUpgradeCheck'] = '2700'
project.root_object.attributes['LastSwiftUpdateCheck'] = '2700'
project.root_object.development_region = 'zh-Hant'
project.root_object.known_regions = ['zh-Hant', 'Base']

config = project.new_file('Config.xcconfig')
project.new_file('Local.example.xcconfig')
group = project.new_group('Shell', 'Shell')
target = project.new_target(:application, 'LongView', :ios, '26.0')

sources = Dir[File.join(here, 'Shell', '*.swift')].sort.map { |file| group.new_file(File.basename(file)) }
target.add_file_references(sources)
target.add_resources([group.new_file('Assets.xcassets')])
group.new_file('Info.plist')

project.build_configurations.each do |configuration|
  configuration.base_configuration_reference = config
  configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '26.0'
end

target.build_configurations.each do |configuration|
  settings = configuration.build_settings
  settings['IPHONEOS_DEPLOYMENT_TARGET'] = '26.0'
  settings['INFOPLIST_FILE'] = 'Shell/Info.plist'
  settings['GENERATE_INFOPLIST_FILE'] = 'NO'
  settings['PRODUCT_BUNDLE_IDENTIFIER'] = '$(BUNDLE_ID)'
  settings['PRODUCT_NAME'] = 'LongView'
  settings['SWIFT_VERSION'] = '5.0'
  # iPhone only, upright only.
  settings['TARGETED_DEVICE_FAMILY'] = '1'
  settings['ASSETCATALOG_COMPILER_APPICON_NAME'] = 'AppIcon'
  settings['ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME'] = 'AccentColor'
  # Signed by Xcode itself with the team named in Local.xcconfig; no capability is asked for, so
  # a free Apple ID is enough.
  settings['CODE_SIGN_STYLE'] = 'Automatic'
  settings.delete('DEVELOPMENT_TEAM')
  settings.delete('MARKETING_VERSION')
  settings.delete('CURRENT_PROJECT_VERSION')
end

project.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.set_launch_target(target)
scheme.save_as(path, 'LongView', true)
puts "wrote #{path}"
