; Tùy biến bộ cài (electron-builder tự nạp file này).

; Luôn cài cho tài khoản đang dùng: không cần quyền admin, bỏ màn hình chọn "all users / only me".
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customWelcomePage
  ; Đặt ở đây vì macro này chạy trước khi các màn hình được tạo; đặt ngoài macro thì không có tác dụng.
  !define MUI_FINISHPAGE_TEXT "Punstudio đã được cài đặt xong.$\r$\n$\r$\nLần sau, bạn mở app từ biểu tượng Punstudio ở màn hình Desktop hoặc tìm trong menu Start."
  !define MUI_WELCOMEPAGE_TITLE "Chào mừng đến với Punstudio"
  !define MUI_WELCOMEPAGE_TEXT "Punstudio đưa mâm xe STL bất kỳ về đúng kích thước chuẩn, tự sửa file lỗi, thêm khối trụ và lỗ trục để sẵn sàng in 3D.$\r$\n$\r$\nCài đặt sẽ tạo biểu tượng ở màn hình Desktop và menu Start."
  !insertmacro MUI_PAGE_WELCOME
!macroend
