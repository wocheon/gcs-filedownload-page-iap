const error = new URLSearchParams(window.location.search).get('error');
const errorElement = document.getElementById('login-error');

if (error === 'invalid') {
  errorElement.textContent = '아이디 또는 비밀번호가 올바르지 않습니다.';
  errorElement.hidden = false;
} else if (error === 'locked') {
  errorElement.textContent = '로그인 시도가 너무 많습니다. 15분 후 다시 시도하세요.';
  errorElement.hidden = false;
}
