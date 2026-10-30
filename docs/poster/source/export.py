#!/usr/bin/env python3
"""把 2x 渲染图导出成 GitHub 用的各尺寸：1280 宽 PNG、社交预览 JPG。"""
from PIL import Image
src = Image.open("deepimage-banner@2x.png").convert("RGB")
src.resize((1280, 640), Image.LANCZOS).save("deepimage-banner-1280.png", optimize=True)
src.save("deepimage-banner.jpg", quality=92, subsampling=1, optimize=True, progressive=True)
src.resize((1280, 640), Image.LANCZOS).save("deepimage-social.jpg", quality=90, subsampling=1, optimize=True, progressive=True)
import os
for f in ["deepimage-banner@2x.png", "deepimage-banner-1280.png", "deepimage-banner.jpg", "deepimage-social.jpg"]:
    print(f"{f:32s} {os.path.getsize(f)/1024:8.0f} KB")
