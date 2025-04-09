// app.js
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const cors = require('cors');

// Charger les variables d'environnement
dotenv.config();

// Initialiser l'application Express
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'test';
const JWT_SECRET = process.env.JWT_SECRET || 'test';

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Connexion à MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/miremover', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('Connecté à MongoDB'))
.catch(err => console.error('Erreur de connexion à MongoDB:', err));

// Modèles Mongoose
const UserSchema = new mongoose.Schema({
  user_id: { type: String, required: true, unique: true },
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password_hash: { type: String },
  full_name: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
  last_login: { type: Date },
  is_active: { type: Boolean, default: true }
});

const StatSchema = new mongoose.Schema({
  stat_id: { type: String, required: true, unique: true },
  user_id: { type: String, required: true },
  date: { type: String, required: true },
  images_processed: { type: Number, default: 0 },
  resize_operations: { type: Number, default: 0 },
  bg_removal_operations: { type: Number, default: 0 },
  face_crop_operations: { type: Number, default: 0 },
  process_time: { type: Number, default: 0 },
  sync_timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Stat = mongoose.model('Stat', StatSchema);

// Middleware d'authentification par API Key
const authenticateApiKey = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'API Key manquante ou invalide' });
  }
  
  const apiKey = authHeader.split(' ')[1];
  
  if (apiKey !== API_KEY) {
    return res.status(401).json({ error: 'API Key invalide' });
  }
  
  next();
};

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'API MiRemover en ligne' });
});

// Inscription d'un utilisateur
app.post('/api/users/register', authenticateApiKey, async (req, res) => {
  try {
    const { user_id, username, email, full_name, created_at } = req.body;
    
    // Vérifier si l'utilisateur existe déjà
    const existingUser = await User.findOne({ 
      $or: [
        { user_id },
        { username },
        { email }
      ]
    });
    
    if (existingUser) {
      // Si l'utilisateur existe déjà avec le même ID, on met à jour
      if (existingUser.user_id === user_id) {
        existingUser.username = username;
        existingUser.email = email;
        existingUser.full_name = full_name;
        await existingUser.save();
        return res.status(200).json({ message: 'Utilisateur mis à jour avec succès' });
      }
      
      // Sinon, c'est un conflit
      return res.status(409).json({ error: 'Nom d\'utilisateur ou email déjà utilisé' });
    }
    
    // Créer un nouvel utilisateur
    const newUser = new User({
      user_id,
      username,
      email,
      full_name,
      created_at: new Date(created_at || Date.now())
    });
    
    await newUser.save();
    
    res.status(201).json({ message: 'Utilisateur enregistré avec succès' });
  } catch (error) {
    console.error('Erreur lors de l\'inscription:', error);
    res.status(500).json({ error: 'Erreur serveur lors de l\'inscription' });
  }
});

// Connexion d'un utilisateur
app.post('/api/users/login', authenticateApiKey, async (req, res) => {
  try {
    const { user_id, username, timestamp } = req.body;
    
    // Rechercher l'utilisateur
    const user = await User.findOne({ user_id });
    
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    
    // Mettre à jour la date de dernière connexion
    user.last_login = new Date(timestamp || Date.now());
    await user.save();
    
    res.status(200).json({ message: 'Connexion enregistrée avec succès' });
  } catch (error) {
    console.error('Erreur lors de l\'enregistrement de la connexion:', error);
    res.status(500).json({ error: 'Erreur serveur lors de l\'enregistrement de la connexion' });
  }
});

// Mise à jour des statistiques
app.post('/api/stats/update', authenticateApiKey, async (req, res) => {
  try {
    const { stats } = req.body;
    
    if (!stats || !Array.isArray(stats) || stats.length === 0) {
      return res.status(400).json({ error: 'Aucune statistique fournie' });
    }
    
    const results = [];
    
    // Traiter chaque statistique
    for (const statData of stats) {
      const { 
        stat_id, user_id, date, images_processed, 
        resize_operations, bg_removal_operations, 
        face_crop_operations, process_time 
      } = statData;
      
      // Rechercher l'utilisateur
      const user = await User.findOne({ user_id });
      
      if (!user) {
        results.push({ stat_id, status: 'error', message: 'Utilisateur non trouvé' });
        continue;
      }
      
      // Rechercher la statistique existante
      let stat = await Stat.findOne({ stat_id });
      
      if (stat) {
        // Mettre à jour
        stat.images_processed = images_processed;
        stat.resize_operations = resize_operations;
        stat.bg_removal_operations = bg_removal_operations;
        stat.face_crop_operations = face_crop_operations;
        stat.process_time = process_time;
        stat.sync_timestamp = new Date();
        
        await stat.save();
        results.push({ stat_id, status: 'updated' });
      } else {
        // Créer
        const newStat = new Stat({
          stat_id,
          user_id,
          date,
          images_processed,
          resize_operations,
          bg_removal_operations,
          face_crop_operations,
          process_time
        });
        
        await newStat.save();
        results.push({ stat_id, status: 'created' });
      }
    }
    
    res.status(200).json({ results });
  } catch (error) {
    console.error('Erreur lors de la mise à jour des statistiques:', error);
    res.status(500).json({ error: 'Erreur serveur lors de la mise à jour des statistiques' });
  }
});

// Récupération des statistiques d'un utilisateur
app.get('/api/stats/:user_id', authenticateApiKey, async (req, res) => {
  try {
    const { user_id } = req.params;
    const { period } = req.query;
    
    // Rechercher l'utilisateur
    const user = await User.findOne({ user_id });
    
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    
    let query = { user_id };
    
    // Filtrer par période
    if (period === 'today') {
      // Format de date: YYYY-MM-DD
      const today = new Date().toISOString().split('T')[0];
      query.date = today;
    } else if (period === 'month') {
      // Format de date: YYYY-MM pour le début du mois
      const currentMonth = new Date().toISOString().substring(0, 7);
      query.date = { $regex: `^${currentMonth}` };
    }
    
    // Récupérer les statistiques
    const stats = await Stat.find(query);
    
    // Calculer les totaux
    const summary = {
      images_processed: 0,
      resize_operations: 0,
      bg_removal_operations: 0,
      face_crop_operations: 0,
      process_time: 0
    };
    
    stats.forEach(stat => {
      summary.images_processed += stat.images_processed;
      summary.resize_operations += stat.resize_operations;
      summary.bg_removal_operations += stat.bg_removal_operations;
      summary.face_crop_operations += stat.face_crop_operations;
      summary.process_time += stat.process_time;
    });
    
    res.status(200).json({ summary, details: stats });
  } catch (error) {
    console.error('Erreur lors de la récupération des statistiques:', error);
    res.status(500).json({ error: 'Erreur serveur lors de la récupération des statistiques' });
  }
});

// Routes de gestion du service

// Liste de tous les utilisateurs (pour administration)
app.get('/api/admin/users', authenticateApiKey, async (req, res) => {
  try {
    const users = await User.find({}, { password_hash: 0 });
    res.status(200).json({ users });
  } catch (error) {
    console.error('Erreur lors de la récupération des utilisateurs:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Statistiques globales (pour administration)
app.get('/api/admin/stats', authenticateApiKey, async (req, res) => {
  try {
    // Nombre total d'utilisateurs
    const userCount = await User.countDocuments();
    
    // Statistiques d'utilisation globales
    const stats = await Stat.aggregate([
      {
        $group: {
          _id: null,
          total_images: { $sum: '$images_processed' },
          total_resize: { $sum: '$resize_operations' },
          total_bg_removal: { $sum: '$bg_removal_operations' },
          total_face_crop: { $sum: '$face_crop_operations' },
          total_time: { $sum: '$process_time' }
        }
      }
    ]);
    
    // Utilisateurs les plus actifs
    const topUsers = await Stat.aggregate([
      {
        $group: {
          _id: '$user_id',
          total_images: { $sum: '$images_processed' },
          total_time: { $sum: '$process_time' }
        }
      },
      { $sort: { total_images: -1 } },
      { $limit: 10 }
    ]);
    
    // Enrichir avec les informations utilisateur
    const enrichedTopUsers = [];
    for (const userStat of topUsers) {
      const user = await User.findOne({ user_id: userStat._id }, { username: 1, email: 1, full_name: 1 });
      if (user) {
        enrichedTopUsers.push({
          ...userStat,
          username: user.username,
          email: user.email,
          full_name: user.full_name
        });
      }
    }
    
    res.status(200).json({
      user_count: userCount,
      global_stats: stats[0] || {
        total_images: 0,
        total_resize: 0,
        total_bg_removal: 0,
        total_face_crop: 0,
        total_time: 0
      },
      top_users: enrichedTopUsers
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des statistiques globales:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`Serveur API MiRemover en écoute sur le port ${PORT}`);
});

module.exports = app;