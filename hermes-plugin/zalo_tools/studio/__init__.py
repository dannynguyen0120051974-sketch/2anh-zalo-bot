"""Xưởng tạo sản phẩm (spec §17) — người không phải chủ nhân nhờ bot làm slide, văn bản, đề, video.

Ranh giới an toàn, đọc trước khi sửa bất cứ gì trong gói này:

1. Mô hình AI viết nội dung KHÔNG có công cụ nào (``author.py`` gọi ``ctx.llm``, một lời gọi
   chat thuần). Lời nhờ của người dùng chỉ là dữ liệu trong lời gọi đó — bị cài chữ đến mấy
   cũng chỉ đổi được nội dung sản phẩm, không chạy được lệnh.
2. Thứ chạy được mã là các bộ dựng CỐ ĐỊNH (``recipes.py``): đường dẫn script, tham số, thư
   mục làm việc đều do plugin quyết. Nội dung do mô hình viết được kiểm (``validate.py``)
   trước khi đưa vào bộ dựng — chặn đúng những lối mà bộ dựng có thể chạy mã hoặc đọc tệp
   (thí nghiệm ``mau: moi`` chạy JS bằng Node, SVG trỏ ra tệp ngoài, video tải ảnh/nhạc…).
3. Bộ dựng chạy trong tiến trình con (``sandbox.py``): môi trường đã lọc sạch khoá, thư mục
   tạm riêng, có hạn giờ. Trên Linux chạy bằng ``systemd-run`` với user ``nobody``, chỉ ghi
   được thư mục việc, không thấy ``/root`` (nơi có ``.env``), không có mạng (trừ video).
4. Gửi trả đúng hội thoại người nhờ, bằng danh tính chụp lúc nhận việc — không bao giờ từ
   tham số mô hình đưa vào (``jobs.py``).
5. Ảnh: mô hình chỉ XIN (câu mô tả / từ khoá). Chỉ ``images.py`` — chạy ở tiến trình cha, ngoài
   hộp cát — vẽ ảnh ở cổng của chủ bot hoặc tải ảnh web (https, chặn địa chỉ nội bộ, kiểm byte
   đầu, có trần). Trang/video chỉ trỏ tới ảnh đã nằm trong thư mục việc bằng mã do plugin đặt.
"""
