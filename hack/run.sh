#!/bin/bash

set -ex

make run-backend &

make start-frontend
