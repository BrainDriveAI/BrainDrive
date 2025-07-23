#!/bin/bash

uvicorn main:app --host 0.0.0.0 --port 8005 --workers 4 --reload
