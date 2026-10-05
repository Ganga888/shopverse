-- One database per Postgres-backed service (mirrors one RDS database/secret per service in AWS).
CREATE DATABASE auth;
CREATE DATABASE users;
CREATE DATABASE catalog;
CREATE DATABASE search;
CREATE DATABASE inventory;
CREATE DATABASE orders;
CREATE DATABASE payments;
CREATE DATABASE shipping;
CREATE DATABASE reviews;
CREATE DATABASE promotions;
CREATE DATABASE audit;
