#!/bin/bash

set -ex

docker stop rss-reader || true
docker container rm rss-reader || true

docker run -d -p 3001:3001 -p 5050:5050 --name rss-reader rss-reader-runtime:latest
