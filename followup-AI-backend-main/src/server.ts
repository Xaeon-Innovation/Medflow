import app from './app';
import logger from './utils/logger';

console.log("🚀 Server starting...");
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`✅ [READY] Server is listening on port ${PORT}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});
