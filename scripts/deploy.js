const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Lỗi: Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong môi trường.');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  console.log('1. Đang tải cấu hình hệ thống từ Supabase...');
  const { data: configData, error: configErr } = await supabase
    .from('chamcong_system_config')
    .select('*');

  if (configErr) {
    console.error('Lỗi tải cấu hình:', configErr);
    process.exit(1);
  }

  // Chuyển danh sách cấu hình sang object map
  const configMap = {};
  configData.forEach(row => {
    configMap[row.key] = row.value;
  });

  const companyName = configMap['company_name'] || 'CHẤM CÔNG CBNV';
  const officeName = configMap['office_name'] || 'Siêu Thanh Hà Nội';
  const companyAddress = configMap['company_address'] || 'Số 5 Nguyễn Ngọc Vũ, Phường Thanh Xuân, TP Hà Nội';
  const officeLat = configMap['office_lat'] || '21.00861322599807';
  const officeLng = configMap['office_lng'] || '105.81294998643875';
  const officeRadius = configMap['office_radius'] || '200';
  const maxDistance = configMap['max_distance'] || '15000';
  const allowHoliday = configMap['allow_holiday'] === 'true';
  const allowMultiple = configMap['allow_multiple'] === 'true';

  console.log('2. Đang cập nhật tệp src/js/config.js...');
  const configJsContent = `// Cấu hình các tham số toàn cục của ứng dụng (Tự động sinh từ GitHub Action)

export const SUPABASE_URL = '${supabaseUrl}';
export const SUPABASE_KEY = 'sb_publishable_VPxkr4o9TCHiM-cVNalB5A_z4x_dG5y'; // Anon key dùng để đọc dữ liệu
export const SUPABASE_FUNC_URL = '${supabaseUrl}/functions/v1';

export const OFFICES = [
  { name: '${officeName}', lat: ${officeLat}, lng: ${officeLng}, radius: ${officeRadius} },
];

export const MAX_DISTANCE = ${maxDistance};

export const ALLOW_HOLIDAY_CHECKIN = ${allowHoliday};
export const ALLOW_MULTIPLE_CHECKIN = ${allowMultiple};

export const DAYS = ['Chủ Nhật','Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy'];
export const GPS_EXPIRE_MS = 1 * 60 * 1000; // GPS hết hạn sau 1 phút
`;

  fs.writeFileSync('src/js/config.js', configJsContent, 'utf8');
  console.log('✓ Đã cập nhật src/js/config.js');

  console.log('3. Đang tải danh sách nhân viên...');
  const { data: emps, error: empErr } = await supabase
    .from('chamcong_employees')
    .select('name, token, status')
    .eq('status', 'Đang làm việc');

  if (empErr) {
    console.error('Lỗi tải nhân viên:', empErr);
    process.exit(1);
  }

  console.log(`Tìm thấy ${emps.length} nhân viên active.`);

  console.log('4. Đang tạo các tệp PWA cá nhân cho iOS...');
  // Xóa thư mục nv cũ và tạo mới
  const nvDir = path.join(__dirname, '../nv');
  if (fs.existsSync(nvDir)) {
    fs.rmSync(nvDir, { recursive: true, force: true });
  }
  fs.mkdirSync(nvDir, { recursive: true });

  const baseHtml = fs.readFileSync('index.html', 'utf8');

  // Hàm chuyển đổi tiếng Việt có dấu sang không dấu để làm tên tệp tin
  function removeAccents(str) {
    return str.normalize('NFD')
              .replace(/[̀-ͯ]/g, '')
              .replace(/đ/g, 'd')
              .replace(/Đ/g, 'D');
  }

  for (let i = 0; i < emps.length; i++) {
    const emp = emps[i];
    const token = emp.token;
    if (!token) continue;

    const slug = removeAccents(emp.name).toLowerCase().replace(/\s+/g, '_');
    const empFolder = path.join(nvDir, token);
    fs.mkdirSync(empFolder, { recursive: true });

    // Inject token định danh cá nhân vào tệp index.html
    let empHtml = baseHtml;

    // Inject token của nhân viên vào thẻ head để main.index.js tự nhận diện không cần URL
    const tokenScript = `<script>window.employeeToken = "${token}";</script>`;
    empHtml = empHtml.replace('<head>', `<head>\n${tokenScript}`);

    // Sinh Manifest cá nhân dạng inline Base64 Data URI cho iOS Safari
    const manifestObj = {
      name: `${companyName} - ${emp.name}`,
      short_name: "Chấm Công",
      start_url: `index.html`, // Mở chính trang này
      display: "standalone",
      background_color: "#f0f4f8",
      theme_color: "#1a73e8",
      icons: [
        { src: "../../icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "../../icon-512.png", sizes: "512x512", type: "image/png" }
      ]
    };

    const base64Manifest = Buffer.from(JSON.stringify(manifestObj)).toString('base64');

    // Thay thế manifest.json chung bằng bản manifest nhúng riêng biệt của nhân viên
    empHtml = empHtml.replace(
      '<link rel="manifest" href="manifest.json">',
      `<link rel="manifest" href="data:application/json;base64,${base64Manifest}">`
    );

    // Thay đổi tiêu đề và địa chỉ hiển thị dựa theo config
    empHtml = empHtml.replace(/<h1>CHẤM CÔNG CBNV<\/h1>/g, `<h1>${companyName.toUpperCase()}<\/h1>`);
    empHtml = empHtml.replace(/📍[^<]*<\/p>/g, `📍 ${companyAddress}</p>`);

    fs.writeFileSync(path.join(empFolder, 'index.html'), empHtml, 'utf8');
  }
  console.log(`✓ Đã tạo thành công ${emps.length} tệp cá nhân trong thư mục /nv/<token>/index.html`);

  console.log('5. Đang cập nhật phiên bản sw.js để ép các client cập nhật cache...');
  const swPath = 'sw.js';
  if (fs.existsSync(swPath)) {
    let swContent = fs.readFileSync(swPath, 'utf8');
    const now = new Date();
    const newVer = `v${now.getFullYear()}.${('0'+(now.getMonth()+1)).slice(-2)}.${('0'+now.getDate()).slice(-2)}_${now.getHours()}${now.getMinutes()}${now.getSeconds()}`;

    swContent = swContent.replace(/const VERSION = '[^']+';/g, `const VERSION = '${newVer}';`);
    fs.writeFileSync(swPath, swContent, 'utf8');
    console.log(`✓ Đã cập nhật sw.js sang phiên bản mới: ${newVer}`);
  }

  console.log('=== HOÀN TẤT TIẾN TRÌNH DEPLOY ===');
}

main().catch(err => {
  console.error('Lỗi trong tiến trình deploy:', err);
  process.exit(1);
});
