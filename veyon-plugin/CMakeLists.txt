# ---------------------------------------------------------------------------
# CMakeLists.txt for the Smart Browser "ProctorFeature" Veyon plugin.
#
# This is NOT built from the app's npm toolchain. It is built as part of (or
# against) a Veyon source tree, because a Veyon plugin must link veyon-core and
# match the ABI of the exact Veyon version it will be loaded into.
#
# Two ways to build (see README.md for full steps):
#
#  A) In-tree: drop this folder into veyon/plugins/ and add
#       add_subdirectory(proctorfeature)
#     to veyon/plugins/CMakeLists.txt, then build Veyon normally. This is the
#     reliable path because build_veyon_plugin() and the core targets are
#     already defined.
#
#  B) Out-of-tree: point CMake at an installed Veyon SDK (headers + veyon-core
#     import lib). Requires VEYON_DIR to locate the SDK. More fragile.
#
# Qt WebSockets is an extra dependency (the stock Veyon build does not pull it
# in) because ProctorBridgeClient talks to the local hub over ws://.
# ---------------------------------------------------------------------------

# When built in-tree, build_veyon_plugin() and QT_MAJOR etc. already exist.
# The guards below let the same file also work standalone.

if(NOT COMMAND build_veyon_plugin)
	cmake_minimum_required(VERSION 3.16)
	project(ProctorFeaturePlugin LANGUAGES CXX)

	set(CMAKE_CXX_STANDARD 17)
	set(CMAKE_CXX_STANDARD_REQUIRED ON)
	set(CMAKE_AUTOMOC ON)

	# TODO(verify): adjust to Qt5 if your Veyon build uses Qt5. Veyon 4.8+ is Qt6.
	find_package(Qt6 REQUIRED COMPONENTS Core Network WebSockets Widgets)

	# TODO(verify): locate the Veyon SDK. VEYON_DIR must contain the installed
	# headers (core/include) and the veyon-core import library.
	if(NOT DEFINED VEYON_DIR)
		message(FATAL_ERROR "Set -DVEYON_DIR=<path to Veyon SDK/source> for out-of-tree builds")
	endif()

	add_library(ProctorFeaturePlugin MODULE
		ProctorFeaturePlugin.cpp
		ProctorBridgeClient.cpp
	)
	target_include_directories(ProctorFeaturePlugin PRIVATE
		${VEYON_DIR}/core/include
	)
	target_link_libraries(ProctorFeaturePlugin PRIVATE
		Qt6::Core Qt6::Network Qt6::WebSockets Qt6::Widgets
		# TODO(verify): the exact imported target/name for veyon-core in your SDK.
		${VEYON_DIR}/lib/veyon-core.lib
	)
	# A Veyon plugin is loaded as a shared module with no "lib" prefix.
	set_target_properties(ProctorFeaturePlugin PROPERTIES PREFIX "")

else()
	# In-tree build: Veyon's helper does the heavy lifting (core link, install
	# path, metadata). We only add the extra Qt WebSockets dependency.
	build_veyon_plugin(proctorfeature
		NAME ProctorFeaturePlugin
		SOURCES
			ProctorFeaturePlugin.cpp
			ProctorFeaturePlugin.h
			ProctorBridgeClient.cpp
			ProctorBridgeClient.h
	)

	# TODO(verify): the created target name. build_veyon_plugin() typically names
	# the target after the first argument ("proctorfeature"). Confirm, then link
	# Qt WebSockets which the base Veyon build does not provide.
	find_package(Qt${QT_MAJOR_VERSION} REQUIRED COMPONENTS WebSockets)
	target_link_libraries(proctorfeature Qt${QT_MAJOR_VERSION}::WebSockets)
endif()
