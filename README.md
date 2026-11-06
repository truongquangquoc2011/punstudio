# Punstudio

Đưa vào một file STL mâm xe bất kỳ, nhận lại mâm có đúng kích thước chuẩn và có sẵn khối trụ + lỗ trục ở mặt trong để in 3D. Thiết kế mặt nan giữ nguyên, app chỉ đổi kích thước và thêm phần cần thiết.

## Thông số mặc định (sửa được trong app)

| Thông số | Mặc định | App làm gì |
|---|---|---|
| Đường kính ngoài | 8,5 mm | Co giãn theo bán kính cho đúng số |
| Bề rộng mâm | 5 mm | Co giãn theo trục cho đúng số (độc lập với đường kính) |
| Viền vành tối thiểu | 1 mm | Chỗ mỏng hơn thì đắp vào phía trong, chỗ dày hơn giữ nguyên |
| Khối trụ sỏ trục | Ø3 mm | Thêm ở tâm mặt trong, từ mép trong tới mặt nan; khối trụ cũ to hơn thì gọt về Ø3 |
| Chiều cao khối trụ | Tự động | Tính từ mặt trong. Để trống: tới mặt nan. Thấp quá không chạm thân mâm thì app cảnh báo |
| Chiều cao vòng đắp viền | Tự động | Tính từ mặt trong. Để trống: tới chỗ nan nối vào vành. Cao hơn thì lấn lên nan, thấp hơn thì đoạn trên vẫn mỏng – app cảnh báo |
| Lỗ trục | Ø1 mm | Khoan xuyên từ mặt trong ra mặt ngoài, đúng 1,00 mm (không cộng dung sai) |

Mọi số trong phần "Kiểm tra" được **đo lại trên lưới kết quả**, không phải lấy từ thông số mong muốn.

## Sửa mâm lỗi

App tự chẩn đoán lưới rồi chọn cách sửa trước khi chuẩn hóa (`src/core/load.ts`):

| Tình trạng file | Cách xử lý | Bề mặt |
|---|---|---|
| Lưới kín | Dùng nguyên | Không đổi |
| Lỗi rất ít (≤ 0,2% số cạnh) | Vá lỗ, lật mặt ngược | Phần còn lại không đổi |
| Lỗi nặng (hở nhiều, mảnh chồng, mặt lật) | Đúc lại thành khối đặc (`src/core/remesh.ts`) | Dựng mới, sai lệch được đo và báo |

Đúc lại: đánh dấu ô lưới có bề mặt đi qua, bịt khe nhỏ, loang từ ngoài vào để tìm phần ruột, giữ các lớp mặt không có độ dày (thân vành, nắp tâm dựng bằng một mặt đơn) với độ dày tối thiểu khoảng 4 ô, rồi dựng lại mặt kín, làm láng bề mặt và làm tròn lại thân vành theo biên dạng trung bình ở từng độ cao. Chi tiết nhỏ hơn khoảng 3 ô (lỗ ốc nhỏ) có thể bị bít – chọn độ mịn cao hơn để giữ được nhiều hơn. Có thể ép đúc lại bằng "Luôn đúc lại".

## Cấu hình đã lưu

Mỗi loại mâm có thể lưu thành một cấu hình có tên, không giới hạn số lượng: nhập số → **Lưu thành cấu hình mới** → đặt tên. Bấm vào tên để dùng lại (mâm đang mở tự chạy lại theo bộ số đó). Sửa số rồi bấm **Lưu vào cấu hình này** để ghi đè. "Mặc định" luôn có sẵn, không sửa hay xóa được.

Cấu hình lưu ngay trên máy đang dùng (bản desktop: thư mục dữ liệu app trong `%APPDATA%\wheel-tool`), không đi kèm bộ cài khi gửi cho người khác. Gỡ app không xóa các cấu hình này.

## Chạy

```bash
npm install
npm run dev        # mở http://127.0.0.1:1430
```

Chạy không cần giao diện (in báo cáo JSON, ghi file kết quả):

```bash
npm run process -- duong/dan/mam.stl ket-qua.stl
npm run process -- duong/dan/mam.stl ket-qua.stl --flip   # đảo mặt trong/ngoài
```

Kiểm thử: `npm test` · kiểm tra kiểu: `npm run typecheck` · đóng gói web: `npm run build`.

## App desktop (.exe)

```bash
npm run app        # chạy bản desktop (Electron) để thử
npm run dist:win   # tạo bộ cài release/Punstudio-Setup-<phiên bản>.exe
```

Bộ cài có giao diện tiếng Việt: màn hình chào, chọn thư mục, tiến trình, hoàn tất. Cài cho tài khoản đang dùng (không cần quyền admin), tạo shortcut ở Desktop và Start Menu. Gỡ trong Settings → Apps. Tùy biến bộ cài ở `build/installer.nsh`.
Bộ cài chưa ký số nên Windows có thể hiện “Windows protected your PC”: bấm **More info → Run anyway**.

Icon và ảnh bộ cài: `npm run icon` tạo lại từ thiết kế trong `scripts/make-icon.cjs`.

## Cập nhật app

Mỗi lần mở (và 6 tiếng một lần), app hỏi GitHub Releases của repo này. Có bản mới thì thanh đầu hiện nút **Cập nhật**: bấm để tải, tải xong bấm **Khởi động lại để cập nhật**. Bấm số phiên bản ở góc phải để kiểm tra bằng tay. Mất mạng thì app im lặng, vẫn dùng bình thường.

Phát hành bản mới:

1. Tăng `version` trong `package.json`.
2. Đặt biến `GH_TOKEN` (token GitHub có quyền ghi repo) rồi chạy `npm run release`: tự build và tải lên Releases dưới dạng bản nháp.
3. Vào trang Releases trên GitHub, bấm **Publish release**. Từ lúc đó app của mọi người mới thấy bản mới.

Cần 3 file trong Release: `Punstudio-Setup-x.y.z.exe`, `.blockmap` và `latest.yml`. Repo phải **công khai** thì app mới đọc được Releases mà không cần đăng nhập.

## Cách hoạt động

1. **Đọc + sửa lưới**: xem mục "Sửa mâm lỗi". Mảnh rác thể tích 0 bị bỏ, khối chồng nhau được gộp.
2. **Tìm trục quay** (trị riêng của phân bố bề mặt, lệch < 5° coi như thẳng trục) và **tâm** (vòng bao nhỏ nhất của mép vành).
3. **Nhận mặt ngoài**: nhìn dọc trục từ hai đầu, phía gặp mặt nan sớm hơn là mặt ngoài. Có nút đảo nếu nhận sai.
4. **Đổi kích thước**, **đắp viền** (lớp tròn xoay bám theo biên dạng ngoài, chỉ ở đoạn vành phía sau mặt nan), **thêm khối trụ**, **khoan lỗ** – bằng phép boolean của thư viện [manifold-3d](https://github.com/elalish/manifold), kết quả luôn là khối kín.
5. **Đo lại** đường kính, bề rộng, lỗ, khối trụ, viền mỏng nhất, số khối.

Toàn bộ chạy trong trình duyệt (Web Worker + WebAssembly), file không gửi đi đâu.

## Giới hạn đã biết

- Mâm có nan chạy sát tới mép trong (không có đoạn vành trống phía sau mặt nan) thì không đắp viền được – app báo rõ.
- Nếu mâm gốc có tỉ lệ khác 8,5 × 5, đổi riêng hai chiều sẽ làm mặt nan dày/mỏng theo bề rộng – app cảnh báo.
- Ở cỡ 8,5 mm, chi tiết nan có thể chỉ còn vài phần mười mm; app không sửa thiết kế nên cần kiểm tra khả năng in của máy.
- STL không có đơn vị; app coi số trong file là mm (không ảnh hưởng vì kích thước được đặt lại).
