cmake_minimum_required(VERSION 3.22.1)
project(ocean CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(OpenXR REQUIRED CONFIG)

# The ported sources and the layer under them, shared with the Mac preview.
set(CORE ${CMAKE_CURRENT_SOURCE_DIR}/../../../../../core)
# -DOCEAN_SCENE=OFF builds the host with its test scene only (for bringing up the host).
option(OCEAN_SCENE "Build the ported ocean sources" ON)
file(GLOB CORE_SOURCES CONFIGURE_DEPENDS ${CORE}/*.cpp)
if(OCEAN_SCENE)
  file(GLOB OCEAN_SOURCES CONFIGURE_DEPENDS ${CORE}/ocean/*.cpp ${CORE}/agent/*.cpp)
else()
  set(OCEAN_SOURCES "")
  add_compile_definitions(OCEAN_NO_SCENE)
endif()
# The agent's cards in the web client's look (core/cards), which the ocean's notes draw.
if(OCEAN_SCENE)
  file(GLOB CARD_SOURCES CONFIGURE_DEPENDS ${CORE}/cards/*.cpp)
  list(APPEND OCEAN_SOURCES ${CARD_SOURCES})
endif()
file(GLOB HOST_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/*.cpp)
if(NOT OCEAN_SCENE)
  list(FILTER HOST_SOURCES EXCLUDE REGEX "canvas_android")
  list(FILTER CORE_SOURCES EXCLUDE REGEX "canvas\\.cpp")
endif()

add_library(ocean SHARED ${HOST_SOURCES} ${CORE_SOURCES} ${OCEAN_SOURCES})
target_include_directories(ocean PRIVATE ${CORE} ${CORE}/ocean ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_options(ocean PRIVATE -Wall -Wno-unused-variable -Wno-unused-function -Wno-missing-braces -fno-math-errno)
target_link_libraries(ocean OpenXR::openxr_loader android log EGL GLESv3 jnigraphics)
