import axios from 'axios';

// كل الطلبات بتتبعت لنفس origin السيرفر (السيرفر بيعمل serve للفرونت في الأصل)،
// في التطوير بنستخدم Vite proxy (شوف vite.config.js) عشان /api و /auth يوصلوا للباكيند على البورت التاني.
// ملحوظة: مش بنحط Content-Type ثابت هنا. axios بيحدده صح لوحده حسب نوع الـ body —
// application/json للـ objects العادية، أو multipart/form-data مع الـ boundary
// الصحيح تلقائيًا لما الـ body يكون FormData (زي رفع صورة البروفايل أو ميديا الشات).
// لو حطينا Content-Type: application/json ثابت هنا، طلبات الـ FormData هتتبعت
// بـ boundary غلط والسيرفر مش هيقدر يقرأها.
const apiClient = axios.create({
  baseURL: '/',
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('nilechat_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('nilechat_token');
      localStorage.removeItem('nilechat_user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
