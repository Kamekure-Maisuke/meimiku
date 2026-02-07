#!/bin/sh
sed "s|__PWD__|$(pwd)|g" podman.yaml | podman play kube -
