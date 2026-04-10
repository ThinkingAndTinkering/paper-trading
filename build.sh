#!/usr/bin/env bash
set -e

# Install backend dependencies
cd backend
pip install -r requirements.txt

# Build frontend
cd ../frontend
npm install
npm run build

# Copy built frontend to backend/static
rm -rf ../backend/static
cp -r dist ../backend/static
