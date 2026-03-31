#!/bin/bash
# 蓝旅自动部署脚本 - 生成预览二维码

# 读取配置
source .env

# 默认版本号从 package.json 读取
VERSION=$(grep -E '"version": ".*"' package.json | cut -d'"' -f4)

echo "开始生成预览二维码..."
echo "版本: $VERSION"
echo "AppID: $APPID"

npx miniprogram-ci preview \
  --pp . \
  --pkp ./private.key \
  --appid "$APPID" \
  --qrcode-format image \
  --qrcode-output-dest ./preview-qr.jpg \
  --upload-version "$VERSION" \
  --upload-desc "v$VERSION 自动预览构建"

echo "预览二维码已生成: preview-qr.jpg"
